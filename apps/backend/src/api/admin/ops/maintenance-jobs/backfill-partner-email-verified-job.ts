import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #858 tail — backfill email-verification for partners created BEFORE
 * `PARTNER_EMAIL_VERIFICATION` was switched on.
 *
 * Native Medusa 2.16+ email verification (`authVerificationsPerActor`) blocks
 * login when no `auth_verification` row for the partner's email has a
 * `verified_at` (see `@medusajs/medusa/.../auth/utils/generate-jwt-token.js`:
 * `if (requiresVerification && !verification?.verified_at)`). Partners created
 * before the flag was enabled never went through the verify flow, so their
 * login now returns `{ verification_required: true }` with an actorless token
 * and they are locked out.
 *
 * This marks each existing partner's emailpass identity verified by upserting a
 * verified `auth_verification` row (create when missing, set `verified_at` when
 * a requested-but-unconfirmed row already exists). There is NO native admin API
 * for this — the only native mutation is `confirmAuthVerification(code)`, which
 * needs the emailed code — so a guarded Data Plumbing job (dry-run → apply,
 * audited, UI-runnable) is the correct backfill surface.
 *
 * Idempotent: an already-verified identity is skipped. Scope to one partner via
 * `partner_id`, or process all (capped by `limit`).
 */

/** Hard cap on partner identities processed in one call. */
export const MAX_PARTNER_VERIFY_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to a single partner (its app_metadata.partner_id). */
  partner_id: z.string().min(1).optional(),
  /** Max partner identities to process in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PARTNER_VERIFY_SCAN)
    .optional()
    .default(1000),
})

export type PartnerVerifyAction = "already_verified" | "create" | "update"

/**
 * PURE: decide what to do for one partner identity given its existing
 * emailpass `auth_verification` row (or undefined). Exported for unit testing.
 *   - a row with `verified_at`  → already verified, nothing to do
 *   - a row without `verified_at` (requested-but-unconfirmed) → set verified_at
 *   - no row at all → create a verified row
 */
export function decidePartnerVerifyAction(
  existing: { verified_at?: Date | string | null } | undefined | null
): PartnerVerifyAction {
  if (existing && existing.verified_at) return "already_verified"
  if (existing) return "update"
  return "create"
}

/**
 * The entity_type the login check keys on, read from the same config the check
 * reads (`authVerificationsPerActor.partner`). Falls back to "email".
 */
function partnerVerificationEntityType(container: any): string {
  try {
    const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
    const forPartner =
      config?.projectConfig?.http?.authVerificationsPerActor?.partner
    const emailpass = (forPartner || []).find(
      (v: any) => v?.auth_provider === "emailpass"
    )
    return emailpass?.entity_type || "email"
  } catch {
    return "email"
  }
}

export const backfillPartnerEmailVerifiedJob: MaintenanceJob = {
  id: "backfill-partner-email-verified",
  label: "Backfill partner email verification",
  description:
    `Mark existing partners' emails verified so they can log in after PARTNER_EMAIL_VERIFICATION was enabled. Partners created before the flag never verified, so their login now returns verification_required and they are locked out. Upserts a verified auth_verification row per partner emailpass identity (create if missing, set verified_at if requested-but-unconfirmed). Idempotent — already-verified identities are skipped. Dry-run lists who WOULD be verified without persisting; apply writes verified_at. Optionally scope to one partner_id. Processes up to 'limit' partner identities per call (default 1000, max ${MAX_PARTNER_VERIFY_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partner identities to process per call (default 1000, max ${MAX_PARTNER_VERIFY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const authModule: any = container.resolve(Modules.AUTH)
    const entityType = partnerVerificationEntityType(container)

    // All auth identities carry app_metadata (the actor pointer) +
    // provider_identities. Partner identities are those with a partner_id in
    // app_metadata and an emailpass provider identity (entity_id = email).
    const identities = await authModule.listAuthIdentities(
      {},
      { relations: ["provider_identities"] }
    )

    let partnerIdentities = (identities || []).filter((ai: any) => {
      const pid = ai?.app_metadata?.partner_id
      if (!pid) return false
      if (partner_id && pid !== partner_id) return false
      return (ai.provider_identities || []).some(
        (p: any) => p?.provider === "emailpass"
      )
    })

    const totalPartnerIdentities = partnerIdentities.length
    partnerIdentities = partnerIdentities.slice(0, limit)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let verified = 0
    let alreadyVerified = 0
    let noEmail = 0
    const now = new Date()

    for (const ai of partnerIdentities) {
      const pid = ai.app_metadata.partner_id
      const emailpass = (ai.provider_identities || []).find(
        (p: any) => p?.provider === "emailpass"
      )
      const email = emailpass?.entity_id
      if (!email) {
        noEmail++
        continue
      }

      let existing: any
      try {
        const rows = await authModule.listAuthVerifications({
          auth_identity_id: ai.id,
          entity_id: email,
          entity_type: entityType,
        })
        existing = rows?.[0]
      } catch (e: any) {
        errors.push({ id: pid, message: e?.message ?? String(e) })
        continue
      }

      const action = decidePartnerVerifyAction(existing)
      if (action === "already_verified") {
        alreadyVerified++
        continue
      }

      changes.push({
        entity: "partner",
        id: pid,
        field: "email_verified",
        before: action === "update" ? "requested (unconfirmed)" : "not verified",
        after: `verified (${email})`,
      })

      if (dry_run) {
        verified++
        continue
      }

      try {
        if (action === "update") {
          await authModule.updateAuthVerifications({
            id: existing.id,
            verified_at: now,
          })
        } else {
          await authModule.createAuthVerifications([
            {
              auth_identity_id: ai.id,
              entity_id: email,
              entity_type: entityType,
              code_provider: "emailpass",
              requested_at: now,
              verified_at: now,
            },
          ])
        }
        verified++
      } catch (e: any) {
        errors.push({ id: pid, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would verify" : "Verified"
    const capped =
      totalPartnerIdentities > partnerIdentities.length
        ? ` (capped at ${limit} of ${totalPartnerIdentities} — re-run to continue)`
        : ""
    const summary = `${verb} ${verified} partner identity(ies); ${alreadyVerified} already verified, ${noEmail} without an emailpass email${
      errors.length ? `, ${errors.length} error(s)` : ""
    }${capped}.`

    return {
      job_id: backfillPartnerEmailVerifiedJob.id,
      dry_run,
      applied: !dry_run && verified > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default backfillPartnerEmailVerifiedJob
