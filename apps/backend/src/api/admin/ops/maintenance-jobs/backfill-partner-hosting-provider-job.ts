import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_MODULE } from "../../../../modules/partner"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #884 S3 tail — backfill the provider-agnostic hosting columns for partners
 * provisioned BEFORE the multi-provider rotation shipped.
 *
 * Pre-#884 partners have `vercel_project_id`/`vercel_project_name`/
 * `vercel_linked` set but a NULL `hosting_provider` / `deployment_project_id` /
 * `deployment_account_id`. The new resolver tolerates that (infers "vercel" +
 * reads vercel_* as a fallback), but rotation load-accounting and the admin/
 * partner "which provider" reads only line up once the generic columns are
 * stamped. This job stamps them:
 *   - hosting_provider          → "vercel"
 *   - deployment_project_id     ← vercel_project_id
 *   - deployment_project_name   ← vercel_project_name
 *   - deployment_account_id     ← the `account_id` param (a Vercel
 *                                 deployment_account created in Settings →
 *                                 Storefront Hosting), when provided
 *
 * When `account_id` is given, the job ALSO bumps that account's `project_count`
 * by the number of partners newly attached to it, so the rotation selector sees
 * the real load. Idempotent: an already-stamped partner (and, when an account is
 * requested, one already attached to it) is skipped. Dry-run lists who WOULD be
 * stamped without persisting.
 */

/** Hard cap on partners processed in one call. */
export const MAX_HOSTING_BACKFILL_SCAN = 5000

const paramsSchema = z.object({
  /**
   * The Vercel `deployment_account` id to attach these partners to (create it
   * first in Settings → Storefront Hosting). Omit to only stamp
   * hosting_provider + deployment_project_* without linking an account.
   */
  account_id: z.string().min(1).optional(),
  /** Restrict to a single partner. */
  partner_id: z.string().min(1).optional(),
  /** Max partners to process in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_HOSTING_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

export type HostingBackfillAction = "already_backfilled" | "not_provisioned" | "stamp"

/**
 * PURE: decide what to do for one partner. Exported for unit testing.
 *   - no vercel project ref at all                        → not_provisioned (skip)
 *   - hosting_provider already set AND (no account asked
 *     OR the requested account already attached)          → already_backfilled
 *   - otherwise                                            → stamp
 */
export function decideHostingBackfillAction(
  partner: {
    vercel_project_id?: string | null
    hosting_provider?: string | null
    deployment_account_id?: string | null
    deployment_project_id?: string | null
  },
  opts: { accountId?: string } = {}
): HostingBackfillAction {
  const hasVercelProject = !!partner?.vercel_project_id
  if (!hasVercelProject) return "not_provisioned"

  const providerStamped =
    !!partner?.hosting_provider && !!partner?.deployment_project_id
  const accountSatisfied = !opts.accountId
    ? true
    : partner?.deployment_account_id === opts.accountId

  if (providerStamped && accountSatisfied) return "already_backfilled"
  return "stamp"
}

export const backfillPartnerHostingProviderJob: MaintenanceJob = {
  id: "backfill-partner-hosting-provider",
  label: "Backfill partner hosting provider (Vercel)",
  description:
    `Stamp the provider-agnostic hosting columns (hosting_provider, deployment_project_id/name, deployment_account_id) on partners provisioned before multi-provider rotation shipped. Pre-#884 partners only have vercel_* columns; this sets hosting_provider="vercel" and copies vercel_project_id/name into the generic columns. Pass account_id (a Vercel deployment_account from Settings → Storefront Hosting) to also LINK partners to it and bump that account's project_count by the number newly attached. Idempotent — already-stamped/attached partners are skipped. Dry-run lists who WOULD be stamped. Optionally scope to one partner_id. Processes up to 'limit' partners per call (default 1000, max ${MAX_HOSTING_BACKFILL_SCAN}).`,
  params: [
    {
      name: "account_id",
      type: "string",
      required: false,
      description:
        "Vercel deployment_account id to attach partners to (create it in Settings → Storefront Hosting first). Omit to stamp columns without linking an account.",
    },
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to a single partner (default: all provisioned partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partners to process per call (default 1000, max ${MAX_HOSTING_BACKFILL_SCAN})`,
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
    const { account_id, partner_id, limit } = parsed.data

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const deployment: any = container.resolve(DEPLOYMENT_MODULE)

    // Validate the target account up front (fail fast, in both dry-run + apply).
    if (account_id) {
      try {
        const acct = await deployment.retrieveDeploymentAccount(account_id)
        if (acct?.provider !== "vercel") {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Deployment account ${account_id} is provider "${acct?.provider}", not "vercel" — this backfill only attaches Vercel partners.`
          )
        }
      } catch (e: any) {
        if (e instanceof MedusaError) throw e
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Deployment account ${account_id} not found`
        )
      }
    }

    const filters: Record<string, any> = {}
    if (partner_id) filters.id = partner_id

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "hosting_provider",
        "deployment_account_id",
        "deployment_project_id",
        "deployment_project_name",
        "vercel_project_id",
        "vercel_project_name",
      ],
      filters,
    })

    const candidates = (partners || []).filter(
      (p: any) =>
        decideHostingBackfillAction(p, { accountId: account_id }) === "stamp"
    )
    const total = candidates.length
    const batch = candidates.slice(0, limit)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let stamped = 0

    for (const p of batch) {
      changes.push({
        entity: "partner",
        id: p.id,
        field: "hosting_provider",
        before: p.hosting_provider ?? "(null)",
        after: account_id ? `vercel → account ${account_id}` : "vercel",
      })

      if (dry_run) {
        stamped++
        continue
      }

      try {
        await partnerService.updatePartners({
          id: p.id,
          hosting_provider: "vercel",
          deployment_project_id: p.vercel_project_id,
          deployment_project_name: p.vercel_project_name ?? null,
          ...(account_id ? { deployment_account_id: account_id } : {}),
        })
        stamped++
      } catch (e: any) {
        errors.push({ id: p.id, message: e?.message ?? String(e) })
      }
    }

    // Bump the target account's live project_count by however many we attached.
    if (!dry_run && account_id && stamped > 0) {
      try {
        const acct = await deployment.retrieveDeploymentAccount(account_id)
        const next = ((acct as any)?.project_count ?? 0) + stamped
        await deployment.updateDeploymentAccounts({ id: account_id, project_count: next })
      } catch (e: any) {
        errors.push({ id: account_id, message: `project_count bump failed: ${e?.message ?? e}` })
      }
    }

    const verb = dry_run ? "Would stamp" : "Stamped"
    const capped =
      total > batch.length ? ` (capped at ${limit} of ${total} — re-run to continue)` : ""
    const link = account_id ? ` and linked to account ${account_id}` : ""
    const summary = `${verb} ${stamped} partner(s) as vercel${link}${
      errors.length ? `, ${errors.length} error(s)` : ""
    }${capped}.`

    return {
      job_id: backfillPartnerHostingProviderJob.id,
      dry_run,
      applied: !dry_run && stamped > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default backfillPartnerHostingProviderJob
