import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PHONE_PIN_AUTH_PROVIDER } from "../../../../modules/phone-pin-auth"
import { PARTNER_MODULE } from "../../../../modules/partner"
import { normalizePhoneE164 } from "../../../../lib/phone/normalize-phone"
import { findPartnerAdminAuthIdentityId } from "../../../../workflows/partners/steps/resolve-partner-admin-auth-identity"
import { updatePartnerAdminWorkflow } from "../../../../workflows/partners/update-partner-admin"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #2320 — phone login for partner admins whose number was saved BEFORE the
 * `phone-pin` provider existed.
 *
 * New saves go through updatePartnerAdminWorkflow, which normalises
 * `partner_admin.phone` to E.164 and attaches a `phone-pin` provider
 * identity to the admin's existing auth identity. Rows saved earlier have
 * free-text phones and no identity, so their owners cannot log in by phone.
 * Apply runs the same workflow per admin, so the backfill and a fresh save can
 * never disagree.
 *
 * Skips, with the reason in the change note: no login, an unreadable number,
 * already linked, or a number two admins share (that one needs a human — a
 * shared number cannot pick a login).
 */

export const MAX_ADMIN_PHONE_SCAN = 5000

const paramsSchema = z.object({
  partner_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(MAX_ADMIN_PHONE_SCAN).optional().default(1000),
})

export type AdminPhoneAction =
  | "link"
  | "already_linked"
  | "no_login"
  | "unreadable"
  | "shared_number"
  | "taken"

/**
 * PURE: decide one admin's action. Exported for unit testing.
 *   - phone not parseable → unreadable
 *   - another admin in this scan has the same number → shared_number
 *   - no auth identity → no_login
 *   - a phone-pin identity with this number already on THIS login → already_linked
 *   - the number belongs to ANOTHER login → taken
 *   - otherwise → link
 */
export function decideAdminPhoneAction(input: {
  phone: string | null
  sharedWithOtherAdmin: boolean
  authIdentityId: string | null
  ownerAuthIdentityId: string | null
}): AdminPhoneAction {
  if (!input.phone) return "unreadable"
  if (input.sharedWithOtherAdmin) return "shared_number"
  if (!input.authIdentityId) return "no_login"
  if (input.ownerAuthIdentityId === input.authIdentityId) return "already_linked"
  if (input.ownerAuthIdentityId) return "taken"
  return "link"
}

export const backfillPartnerAdminPhoneLoginJob: MaintenanceJob = {
  id: "backfill-partner-admin-phone-login",
  label: "Backfill partner admin phone login",
  description: `Let partner admins whose phone was saved before phone login existed (#2320) log in with it. For each admin with a phone: normalise it to E.164 and attach a phone-pin login to their existing account (the same workflow a profile save runs). Skips admins with no login, unreadable numbers, numbers already linked, and numbers two admins share — those are listed for a human. Dry-run lists what WOULD change. Optionally scope to one partner_id. Up to 'limit' admins per call (default 1000, max ${MAX_ADMIN_PHONE_SCAN}).`,
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
      description: `Max admins to process per call (default 1000, max ${MAX_ADMIN_PHONE_SCAN})`,
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

    const partnerService: any = container.resolve(PARTNER_MODULE)
    const authModule: any = container.resolve(Modules.AUTH)

    const filters: Record<string, unknown> = { phone: { $ne: null } }
    if (partner_id) filters.partner_id = partner_id
    const [admins, total] = await partnerService.listAndCountPartnerAdmins(filters, {
      select: ["id", "email", "phone", "partner_id"],
      take: limit,
      order: { created_at: "ASC" },
    })

    // Count numbers across the scan so a shared one is caught before any write.
    const byPhone = new Map<string, number>()
    const normalized = new Map<string, string | null>()
    for (const a of admins) {
      const p = normalizePhoneE164(a.phone)
      normalized.set(a.id, p)
      if (p) byPhone.set(p, (byPhone.get(p) ?? 0) + 1)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const counts: Record<AdminPhoneAction, number> = {
      link: 0,
      already_linked: 0,
      no_login: 0,
      unreadable: 0,
      shared_number: 0,
      taken: 0,
    }
    let written = 0

    for (const a of admins) {
      if (!String(a.phone ?? "").trim()) continue
      const phone = normalized.get(a.id) ?? null
      try {
        const authIdentityId = await findPartnerAdminAuthIdentityId(container, a)
        let ownerAuthIdentityId: string | null = null
        if (phone) {
          const [owner] = await authModule.listProviderIdentities({
            provider: PHONE_PIN_AUTH_PROVIDER,
            entity_id: phone,
          })
          ownerAuthIdentityId = owner?.auth_identity_id ?? null
        }

        const action = decideAdminPhoneAction({
          phone,
          sharedWithOtherAdmin: !!phone && (byPhone.get(phone) ?? 0) > 1,
          authIdentityId,
          ownerAuthIdentityId,
        })
        counts[action]++

        if (action === "already_linked" && a.phone === phone) continue
        if (action !== "link" && action !== "already_linked") {
          changes.push({
            entity: "partner_admin",
            id: a.id,
            field: "phone_login",
            before: a.phone,
            after: "skipped",
            note: `${action} (partner ${a.partner_id}, ${a.email})`,
          })
          continue
        }

        changes.push({
          entity: "partner_admin",
          id: a.id,
          field: "phone_login",
          before: a.phone,
          after: phone,
          note:
            action === "link"
              ? `attach phone-pin login (partner ${a.partner_id}, ${a.email})`
              : `already linked; normalise stored phone (partner ${a.partner_id})`,
        })
        if (dry_run) continue

        await updatePartnerAdminWorkflow(container).run({
          input: { id: a.id, update: { phone: a.phone } },
        })
        written++
      } catch (e: any) {
        errors.push({ id: a.id, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would link" : "Linked"
    const capped =
      total > admins.length ? ` (capped at ${limit} of ${total} — re-run to continue)` : ""
    const summary = `${verb} ${counts.link} admin phone(s); ${counts.already_linked} already linked, ${counts.no_login} without a login, ${counts.unreadable} unreadable, ${counts.shared_number} shared by two admins, ${counts.taken} taken by another login${
      errors.length ? `, ${errors.length} error(s)` : ""
    }${capped}.`

    return {
      job_id: backfillPartnerAdminPhoneLoginJob.id,
      dry_run,
      applied: !dry_run && written > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default backfillPartnerAdminPhoneLoginJob
