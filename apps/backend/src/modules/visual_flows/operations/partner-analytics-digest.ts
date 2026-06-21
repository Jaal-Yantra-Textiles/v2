import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"
import { PARTNER_MODULE } from "../../partner"
import {
  getPartnerStorefrontDigestWorkflow,
  type GetPartnerStorefrontDigestInput,
} from "../../../workflows/analytics/get-partner-storefront-digest"
import type {
  DigestPeriod,
  PartnerStorefrontDigest,
} from "../../../workflows/analytics/partner-digest-lib"

/**
 * Partner storefront analytics digest operation (#581 S3).
 *
 * Wraps the S1 `getPartnerStorefrontDigestWorkflow` so a visual flow can
 * compute a per-partner storefront analytics digest (#569 KPIs + #559
 * breakdowns + rule-based suggestions) for one partner, an explicit list, or
 * every active partner — without an admin building a bespoke loop node.
 *
 * Why this isn't doable with `trigger_workflow` alone:
 *   - the weekly flow needs ALL active partners as its fan-out source, which
 *     means listing them (a query) before any per-item invocation
 *   - per-partner digest compute must never crash the run (one un-provisioned
 *     partner shouldn't abort the others) — this op swallows per-partner errors
 *   - the output is shaped as an array under `digests` so it feeds straight
 *     into `bulk_trigger_workflow` (items: `{{ partner_digest.digests }}`,
 *     input_template: `{ digest: "{{ item }}" }`) → `send-partner-digest-email`
 *
 * Output:
 *   `{ digests: PartnerStorefrontDigest[], records, count, with_storefront,
 *      with_suggestions, requested, failed, errors }`
 *   `records` aliases `digests` so panels that read `display.field`-style
 *   array outputs work too.
 */

export const partnerAnalyticsDigestOptionsSchema = z.object({
  /** Single partner id (or a {{ variable }} reference). */
  partner_id: z.string().optional(),
  /** Explicit partner ids (or a {{ variable }} reference resolving to an array). */
  partner_ids: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * Named window or `{ days }`. Defaults to last 7 days — a weekly digest.
   * Passed through verbatim to the S1 workflow.
   */
  period: z
    .union([
      z.enum(["last_7_days", "last_28_days", "last_30_days"]),
      z.object({ days: z.number().int().min(1).max(365) }),
    ])
    .optional(),
  /** Partial threshold overrides for the suggestion rules (S1). */
  thresholds: z.record(z.string(), z.any()).optional(),
  /** ISO timestamp; injectable for deterministic runs. Defaults to now. */
  now: z.string().optional(),
  /** Cap on partners processed in one run. */
  max_partners: z.number().int().min(1).max(1000).default(200),
  /** Keep going when a single partner's digest compute throws. */
  continue_on_error: z.boolean().default(true),
})

export type PartnerAnalyticsDigestOptions = z.infer<
  typeof partnerAnalyticsDigestOptionsSchema
>

/**
 * Resolve the final, de-duplicated, capped list of partner ids to process.
 *
 * Precedence: an explicit `partner_id` / `partner_ids` selection wins; only
 * when neither is supplied do we fall back to the listed (active) partners.
 * Pure so it's unit-testable without booting Medusa.
 */
export function selectDigestPartnerIds(input: {
  partnerId?: string | null
  partnerIds?: unknown
  listedPartnerIds?: string[]
  maxPartners?: number
}): string[] {
  const cap =
    Number.isFinite(input.maxPartners) && (input.maxPartners as number) > 0
      ? Math.floor(input.maxPartners as number)
      : 200

  const explicit: string[] = []
  if (typeof input.partnerId === "string" && input.partnerId.trim()) {
    explicit.push(input.partnerId.trim())
  }
  if (Array.isArray(input.partnerIds)) {
    for (const v of input.partnerIds) {
      if (typeof v === "string" && v.trim()) explicit.push(v.trim())
    }
  } else if (
    typeof input.partnerIds === "string" &&
    (input.partnerIds as string).trim()
  ) {
    explicit.push((input.partnerIds as string).trim())
  }

  const source =
    explicit.length > 0
      ? explicit
      : (input.listedPartnerIds ?? []).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )

  // De-dupe preserving first-seen order, then cap.
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of source) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= cap) break
  }
  return out
}

/**
 * Roll digests up into the flat scalars a downstream condition/log node or a
 * metric panel can read. Pure.
 */
export function summarizeDigestRun(digests: PartnerStorefrontDigest[]): {
  count: number
  with_storefront: number
  with_suggestions: number
  suggestion_count: number
} {
  let withStorefront = 0
  let withSuggestions = 0
  let suggestionCount = 0
  for (const d of digests) {
    if (d?.website) withStorefront++
    const n = Array.isArray(d?.suggestions) ? d.suggestions.length : 0
    if (n > 0) withSuggestions++
    suggestionCount += n
  }
  return {
    count: digests.length,
    with_storefront: withStorefront,
    with_suggestions: withSuggestions,
    suggestion_count: suggestionCount,
  }
}

export const partnerAnalyticsDigestOperation: OperationDefinition = {
  type: "partner_analytics_digest",
  name: "Partner Analytics Digest",
  description:
    "Compute a per-partner storefront analytics digest (KPIs + breakdowns + rule-based suggestions) for one partner, an explicit list, or every active partner. Output `digests[]` feeds bulk_trigger_workflow → send-partner-digest-email.",
  icon: "chart-bar",
  category: "data",
  optionsSchema: partnerAnalyticsDigestOptionsSchema,

  defaultOptions: {
    period: "last_7_days",
    max_partners: 200,
    continue_on_error: true,
  },

  execute: async (
    options: any,
    context: OperationContext
  ): Promise<OperationResult> => {
    try {
      const parsed = partnerAnalyticsDigestOptionsSchema.parse(options ?? {})
      const continueOnError = parsed.continue_on_error !== false

      // Resolve {{ variable }} references in the partner selectors.
      const resolvedPartnerId = parsed.partner_id
        ? interpolateVariables(parsed.partner_id, context.dataChain)
        : undefined
      const resolvedPartnerIds =
        parsed.partner_ids !== undefined
          ? interpolateVariables(parsed.partner_ids, context.dataChain)
          : undefined

      // Only list partners when no explicit selection was supplied.
      const hasExplicit =
        (typeof resolvedPartnerId === "string" && resolvedPartnerId.trim()) ||
        (Array.isArray(resolvedPartnerIds) && resolvedPartnerIds.length > 0) ||
        (typeof resolvedPartnerIds === "string" && resolvedPartnerIds.trim())

      let listedPartnerIds: string[] = []
      if (!hasExplicit) {
        const partnerService: any = context.container.resolve(PARTNER_MODULE)
        const [partners] = await partnerService.listAndCountPartners(
          { status: "active" },
          { take: parsed.max_partners, select: ["id"] }
        )
        listedPartnerIds = (partners ?? [])
          .map((p: any) => p?.id)
          .filter((id: any): id is string => typeof id === "string")
      }

      const partnerIds = selectDigestPartnerIds({
        partnerId:
          typeof resolvedPartnerId === "string" ? resolvedPartnerId : undefined,
        partnerIds: resolvedPartnerIds,
        listedPartnerIds,
        maxPartners: parsed.max_partners,
      })

      if (partnerIds.length === 0) {
        return {
          success: true,
          data: {
            digests: [],
            records: [],
            count: 0,
            with_storefront: 0,
            with_suggestions: 0,
            suggestion_count: 0,
            requested: 0,
            failed: 0,
            errors: [],
          },
        }
      }

      const digests: PartnerStorefrontDigest[] = []
      const errors: Array<{ partner_id: string; error: string }> = []

      for (const partnerId of partnerIds) {
        const input: GetPartnerStorefrontDigestInput = {
          partner_id: partnerId,
          period: parsed.period as DigestPeriod | undefined,
          thresholds: parsed.thresholds as any,
          now: parsed.now,
        }
        try {
          const { result } = await getPartnerStorefrontDigestWorkflow(
            context.container
          ).run({ input })
          if (result) digests.push(result as PartnerStorefrontDigest)
        } catch (err: any) {
          errors.push({
            partner_id: partnerId,
            error: err?.message ?? String(err),
          })
          if (!continueOnError) {
            return {
              success: false,
              error: `Digest compute failed for partner ${partnerId}: ${err?.message ?? err}`,
              errorStack: err?.stack,
            }
          }
        }
      }

      const summary = summarizeDigestRun(digests)

      return {
        success: true,
        data: {
          digests,
          records: digests,
          ...summary,
          requested: partnerIds.length,
          failed: errors.length,
          errors,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
