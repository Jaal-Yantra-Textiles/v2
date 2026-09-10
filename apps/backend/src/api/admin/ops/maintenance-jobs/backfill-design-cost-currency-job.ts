import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { DESIGN_MODULE } from "../../../../modules/designs"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — say what a design was costed IN, so approval stops guessing
 * (#1979).
 *
 * `resolveApprovalCurrency` read `designCurrency || storeCurrency || "inr"`.
 * JYT Medu Store's default is EUR, so a design that never recorded a currency
 * was listed in euros: a jacket costed at ₹2,634.75 minted as €2,634.75 and
 * `replay-fx-fanout` propagated that base into all 11 currencies, listing it at
 * ₹291,560 — about 110× its cost.
 *
 * The resolver no longer consults the store, so the fallback is INR and the
 * mis-pricing has stopped. This job removes the GUESS: a design that states
 * its currency is not relying on any fallback at all.
 *
 * ## Why INR, and why this is an inference rather than a reading
 *
 * 🔴 Worth being honest about, because it is the whole risk of this job.
 * `cost_breakdown` records a `cost_source` per line — `order_history`,
 * `unit_cost`, `raw_material`, `estimated` — and **not one line records a
 * currency**. 18 of the 45 candidates on prod have no breakdown at all. So the
 * currency cannot be READ from the cost's own provenance; it is inferred from
 * "production is costed in INR" (the unified order carries `currency_assumed:
 * true` for the same reason).
 *
 * That is why the currency is a PARAMETER with an INR default rather than a
 * constant, and why `design_id` exists: a design costed by someone abroad can
 * be stamped individually with the right code instead of being swept up.
 *
 * ## What keeps it safe
 *
 * ⚠️ It only ever fills a BLANK. A design that already states a currency is
 * never a candidate, so a value someone set by hand — including the two set by
 * hand while #1979 was being diagnosed — cannot be overwritten by a re-run or
 * by a mis-scoped one.
 *
 * ⚠️ It requires a cost > 0. A design with no cost has nothing to denominate,
 * and stamping a currency onto it would state something we do not know.
 *
 * It writes one field, creates nothing, prices nothing, and touches no product,
 * payment or order. Safe to re-run: once stamped, a design is no longer blank.
 *
 * 🔴 It does NOT re-price the products of designs already approved under the
 * old EUR behaviour. Those carry a wrong price TODAY and stamping the design
 * does not correct them — the variant prices are a separate, deliberate repair.
 */
const paramsSchema = z.object({
  /** One design, for a spot check before a full pass — or for a non-INR one. */
  design_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every design that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /**
   * The currency to stamp. Defaults to INR because production is costed in INR.
   * A parameter, not a constant, because this is an inference: a design costed
   * abroad should be stamped individually with `design_id`.
   */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter code, e.g. 'inr'")
    .optional(),
})

/**
 * PURE: the stored cost as a number, or 0 when there isn't one.
 * Exported for tests.
 *
 * ⚠️ Three shapes reach this. The column is bigNumber-ish, so it arrives as a
 * number, as a string (`"4000"`), or as `{ value: "4000", precision: 20 }` —
 * the last is what the admin API actually returns on prod, and reading it with
 * a bare `Number()` yields `NaN`, which would silently skip every such row.
 */
export function storedCost(design: { estimated_cost?: unknown }): number {
  let raw: unknown = design?.estimated_cost
  if (raw && typeof raw === "object" && "value" in (raw as any)) {
    raw = (raw as any).value
  }
  if (raw === null || raw === undefined || raw === "") {
    return 0
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

/**
 * PURE: does this design have a cost but no currency to read it in?
 * Exported for tests — this is the whole blast radius of the job.
 *
 * ⚠️ `""` and `"   "` count as blank. `''` is falsy but is not null (the shape
 * that defeated an `is not null` CHECK elsewhere in this codebase), and a
 * whitespace-only code is not a statement of anything either.
 */
export function needsCostCurrency(design: {
  estimated_cost?: unknown
  cost_currency?: unknown
}): boolean {
  if (storedCost(design) <= 0) {
    return false
  }
  return String(design?.cost_currency ?? "").trim() === ""
}

export const backfillDesignCostCurrencyJob: MaintenanceJob = {
  id: "backfill-design-cost-currency",
  label: "Say what a design was costed in (cost_currency)",
  description:
    "Stamp cost_currency (default INR) on designs that have an estimated_cost but no currency, so approval stops falling back (#1979). The approve path read `design.cost_currency || store default || inr`, and this store's default is EUR — so an INR-costed design minted in euros and fanned out at ~110x its cost. HONEST CAVEAT: no cost_breakdown line records a currency and many designs have no breakdown at all, so INR is INFERRED from 'production is costed in INR', not read from the data — which is why the currency is a parameter and design_id lets you stamp an individually-costed design with the right code instead. Only ever fills a BLANK: a design that already states a currency can never be overwritten, including by a re-run. Requires a cost > 0, because a design with no cost has nothing to denominate. Writes one field; creates nothing, prices nothing, touches no product, payment or order. Does NOT re-price products already approved under the old EUR behaviour — that is a separate repair.",
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description:
        "Only this design — for a spot check before a full pass, or to stamp a design costed in something other than the default.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many designs. Omit for every design that needs one.",
    },
    {
      name: "currency",
      type: "string",
      required: false,
      description:
        "3-letter code to stamp. Defaults to 'inr' because production is costed in INR.",
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

    const currency = (parsed.data.currency ?? "inr").trim().toLowerCase()
    const designService: any = container.resolve(DESIGN_MODULE)

    const designs = (await designService.listDesigns(
      parsed.data.design_id ? { id: parsed.data.design_id } : {},
      { take: null }
    )) as any[]

    if (parsed.data.design_id && !(designs || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${parsed.data.design_id} not found`
      )
    }

    const candidates = (designs || []).filter(needsCostCurrency)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const design of candidates) {
      if (parsed.data.limit && changes.length >= parsed.data.limit) {
        break
      }

      try {
        /**
         * The `note` carries the evidence, so a dry-run can be ARGUED WITH: the
         * figure being denominated, the design's status (an already-approved
         * one may have a wrong price live), and whether any cost provenance
         * exists at all. A dry-run that lists ids and nothing else can only be
         * checked by re-deriving it by hand.
         */
        const bd = (design as any)?.cost_breakdown
        const lines = Array.isArray(bd) ? bd : bd?.items
        const provenance = Array.isArray(lines) && lines.length
          ? [
              ...new Set(
                lines
                  .map((l: any) => String(l?.cost_source ?? "").trim())
                  .filter(Boolean)
              ),
            ].join("/")
          : "no cost_breakdown"

        changes.push({
          entity: "design",
          id: design.id,
          field: "cost_currency",
          before: design.cost_currency ?? null,
          after: currency,
          note: `${design.name ?? "(unnamed)"} — cost ${storedCost(
            design
          )}, status ${design.status ?? "(none)"}, provenance: ${provenance}`,
        })

        if (!dry_run) {
          await designService.updateDesigns({
            id: design.id,
            cost_currency: currency,
          })
        }
      } catch (e: any) {
        // One unreadable design must not strand the rest of the pass.
        errors.push({ id: design?.id ?? "(unknown)", message: e?.message ?? String(e) })
      }
    }

    const approved = changes.filter((c) =>
      String(c.note ?? "").includes("status Approved")
    ).length

    const parts: string[] = []
    parts.push(
      changes.length
        ? `${dry_run ? "Would stamp" : "Stamped"} cost_currency=${currency} on ${
            changes.length
          } design(s) that had a cost but no currency`
        : "Every costed design already states a currency"
    )
    if (approved) {
      parts.push(
        `⚠️ ${approved} of them are already Approved — their products were minted under the old fallback and may carry a wrong price RIGHT NOW; stamping the design does not correct a variant price`
      )
    }

    return {
      job_id: "backfill-design-cost-currency",
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: parts.join(". ") + ".",
      changes,
      errors,
    }
  },
}
