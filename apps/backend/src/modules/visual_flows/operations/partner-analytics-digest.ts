import { z } from "@medusajs/framework/zod"
import { generateText } from "ai"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"
import { PARTNER_MODULE } from "../../partner"
import {
  composeDigestAiSummary,
  resolveDigestModelOverride,
  type DigestAiGenerate,
} from "../../../workflows/analytics/partner-digest-ai-lib"
import {
  getAiPlatformForRole,
  buildChatModel,
} from "../../../mastra/services/ai-platforms"
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
  /**
   * When true, enrich each eligible digest with a short AI-authored weekly
   * summary (#589 item 3) before the email fan-out. Best-effort: an AI failure
   * never aborts the run, it just leaves `ai_summary` unset. Default OFF so the
   * live weekly flow's behaviour is unchanged until an admin opts in.
   */
  generate_ai_summary: z.boolean().default(false),
  /** Override the model used for the AI summary (defaults to the ai_extract model). */
  ai_summary_model: z.string().optional(),
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
 * A partner is digest-eligible only when they have a **live storefront** — i.e.
 * the S1 digest resolved a linked website (truthy `website.id`). Partners with
 * no storefront (`website: null`) have nothing to report and must be excluded
 * from the email fan-out entirely (#589): the first fan-out mis-emailed
 * no-store partners. A has-store partner with zero traffic is STILL eligible —
 * they get the zero-data "start sharing" nudge, not exclusion. Pure.
 */
export function isPartnerDigestEligible(
  digest: Pick<PartnerStorefrontDigest, "website"> | null | undefined
): boolean {
  const w = digest?.website
  return !!(w && typeof w.id === "string" && w.id.trim().length > 0)
}

/**
 * Split computed digests into the storefront-eligible set (the email fan-out
 * source) and a count of partners excluded for having no live storefront.
 * Pure so it's unit-testable without booting Medusa.
 */
export function partitionEligibleDigests(
  digests: PartnerStorefrontDigest[]
): { eligible: PartnerStorefrontDigest[]; excluded: number } {
  const eligible: PartnerStorefrontDigest[] = []
  let excluded = 0
  for (const d of digests ?? []) {
    if (isPartnerDigestEligible(d)) eligible.push(d)
    else excluded++
  }
  return { eligible, excluded }
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
            computed: 0,
            excluded: 0,
            requested: 0,
            failed: 0,
            errors: [],
          },
        }
      }

      const computedDigests: PartnerStorefrontDigest[] = []
      const errors: Array<{ partner_id: string; error: string }> = []

      // Default-OFF AI summary enrichment (#589 items 3-4). Only build the
      // generator when the option is set; otherwise the weekly run never
      // touches the model. The provider/api-key/base-url/default-model are
      // resolved from the admin-configured External Platform (category=ai,
      // metadata.role="ai_digest_summary") via the same resolver the
      // `ai_extract_platform` op uses — NOT the hardcoded OPENROUTER_API_KEY.
      //
      // When no platform is configured for the role, `getAiPlatformForRole`
      // returns null → we leave `aiGenerate` null so the digest's existing
      // best-effort path leaves `ai_summary` unset (mirrors continue_on_error).
      // We never throw.
      const aiPlatform = parsed.generate_ai_summary
        ? await getAiPlatformForRole(
            context.container as any,
            "ai_digest_summary"
          )
        : null

      const aiGenerate: DigestAiGenerate | null = aiPlatform
        ? async ({ system, prompt, model }) => {
            // modelOverride precedence (#589 item 4): explicit option →
            // platform default_model → DIGEST_AI_DEFAULT_MODEL hint. The
            // `model` arg from composeDigestAiSummary already carries the
            // option-or-default, so it serves as the last-resort fallback.
            const modelOverride = resolveDigestModelOverride(
              parsed.ai_summary_model,
              aiPlatform.defaultModel,
              model
            )
            const chatModel = buildChatModel(aiPlatform, modelOverride)
            const result = await generateText({
              model: chatModel as any,
              system,
              messages: [{ role: "user", content: prompt }],
            })
            return result.text ?? ""
          }
        : null

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
          if (result) {
            const digest = result as PartnerStorefrontDigest
            if (aiGenerate) {
              // Best-effort: never let an AI hiccup abort the digest run.
              digest.ai_summary = await composeDigestAiSummary(digest, aiGenerate, {
                model: parsed.ai_summary_model,
              })
            }
            computedDigests.push(digest)
          }
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

      // Recipient filter (#589): only partners with a live storefront receive a
      // digest email. No-store partners (`website: null`) are excluded from the
      // `digests[]` fan-out source entirely so bulk_trigger_workflow →
      // send-partner-digest-email never mails them.
      const { eligible, excluded } = partitionEligibleDigests(computedDigests)
      const summary = summarizeDigestRun(eligible)

      return {
        success: true,
        data: {
          digests: eligible,
          records: eligible,
          ...summary,
          computed: computedDigests.length,
          excluded,
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
