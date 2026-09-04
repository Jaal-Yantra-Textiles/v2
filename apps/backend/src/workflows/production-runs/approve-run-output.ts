import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { createProductFromDesignWorkflow } from "../designs/create-product-from-design"
import updateDesignWorkflow from "../designs/update-design"

/**
 * Reviewing what a completed run PRODUCED (#1805).
 *
 * The founder's ask: *"select all complete runs and mass approve/reject.
 * Reject means no product created, approve means a product was created."*
 *
 * ## Why this is not a loop around `POST /admin/designs/:id/approve`
 *
 * Three things break at scale, and each is silent:
 *
 * 🔴 **Approving twice does not no-op — it adds a variant.**
 * `create-product-from-design` branches on whether the design already has a
 * linked product, and when it does it appends another `"Custom - <name>"`
 * variant. One at a time that is a rare misclick. Over a selection of runs it
 * is the DEFAULT outcome, because a design routinely has several completed
 * runs — parent/child partner assignments, recreated runs — and the operator
 * selecting "all completed" selects all of them. So the unit of the decision
 * is the RUN, but the unit of product creation is the DESIGN, and a design
 * that already has a product is left alone.
 *
 * 🔴 **`currency_code: "usd"` was hardcoded** in the approve route while the
 * platform trades in AUD and INR. At scale that mis-prices a whole batch. The
 * design's own `cost_currency` is the answer; the store default is the
 * fallback (see `resolveApprovalCurrency`).
 *
 * 🔴 **A partial batch is a real outcome and must be said out loud** (#1263).
 * Every run comes back with what happened to it — approved, rejected, skipped
 * or failed, and why — rather than one 200 that flattens 40 runs into "done".
 *
 * ## Rejection changes nothing about the WORK
 *
 * A rejected run stays `completed`. The partner made the goods and is still
 * owed for `produced_quantity`; billing keys on that status. Rejection is
 * recorded on its own axis (`approval_decision`), which is also what lets the
 * queue tell "rejected" from "nobody has looked yet".
 */

export type RunApprovalDecision = "approve" | "reject"

export type RunApprovalOutcome =
  | "approved"
  | "rejected"
  /** Ineligible, and deliberately not an error — the batch carries on. */
  | "skipped"
  /** Eligible, attempted, and it threw. Isolated to this run. */
  | "failed"

export type RunApprovalReport = {
  run_id: string
  design_id: string | null
  design_name: string | null
  status: string | null
  outcome: RunApprovalOutcome
  /** Why, whenever the outcome is not the obvious one. */
  reason?: string
  product_id?: string | null
  variant_id?: string | null
  /**
   * The product was already there and was NOT re-created. The difference
   * between this and a fresh approval is the whole idempotency story, so it is
   * reported rather than hidden behind an identical-looking success.
   */
  product_existed?: boolean
  currency_code?: string
  listed_price?: number
}

export type RunApprovalResult = {
  decision: RunApprovalDecision
  dry_run?: boolean
  /** One row per requested run, in the order given. */
  runs: RunApprovalReport[]
  /** Distinct designs the decision actually applied to. */
  design_ids: string[]
  /** Products created by THIS call. Empty on a re-run — that is the point. */
  created_product_ids: string[]
  approved: string[]
  rejected: string[]
  skipped: string[]
  failed: string[]
}

/**
 * PURE. The currency a design's product is listed in. Exported for tests.
 *
 * 🔴 The approve route hardcoded `"usd"` on a platform trading in AUD and INR,
 * so every approved design was listed in a currency nobody sells in. The
 * design's own `cost_currency` is what the work was costed in and is the only
 * figure with a claim to authority here; the store default is a fallback for
 * designs costed before that column was filled in, and `"usd"` survives only as
 * the last resort it always was.
 */
export function resolveApprovalCurrency(input: {
  designCurrency?: string | null
  storeCurrency?: string | null
}): string {
  const pick = input.designCurrency || input.storeCurrency || "usd"
  return String(pick).trim().toLowerCase()
}

/** The store's default currency, for designs that never recorded their own. */
export async function readStoreCurrency(container: any): Promise<string | null> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: stores = [] } = await query.graph({
      entity: "store",
      fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default"],
    })
    const supported = stores?.[0]?.supported_currencies ?? []
    const fallback = supported.find((c: any) => c?.is_default) ?? supported[0]
    return fallback?.currency_code ?? null
  } catch {
    // A store we cannot read is not a reason to refuse the batch; the design's
    // own currency answers for most rows, and `resolveApprovalCurrency` still
    // has its last resort.
    return null
  }
}

const isDecided = (run: any) => Boolean(run?.approval_decision)

export async function applyRunApprovals(
  container: any,
  input: {
    runIds: string[]
    decision: RunApprovalDecision
    reason?: string | null
    actorId?: string | null
    dryRun?: boolean
  }
): Promise<RunApprovalResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  const requested = [...new Set(input.runIds.filter(Boolean))]
  const reports: RunApprovalReport[] = []

  /**
   * 🔴 Never call the service with an empty id list. `filters: { id: [] }` is
   * NOT "no rows" in every Medusa reader — an absent filter means ALL rows, and
   * a bulk decision applied to every run on the platform is the one mistake
   * this function must be incapable of.
   */
  if (!requested.length) {
    return {
      decision: input.decision,
      dry_run: input.dryRun || undefined,
      runs: [],
      design_ids: [],
      created_product_ids: [],
      approved: [],
      rejected: [],
      skipped: [],
      failed: [],
    }
  }

  const runs: any[] = await runService.listProductionRuns({ id: requested })
  const byId = new Map<string, any>(runs.map((r: any) => [r.id, r]))

  // ---- 1. Which runs may be decided at all -------------------------------
  const eligible: any[] = []

  for (const runId of requested) {
    const run = byId.get(runId)

    if (!run) {
      reports.push({
        run_id: runId,
        design_id: null,
        design_name: null,
        status: null,
        outcome: "failed",
        reason: "No such production run.",
      })
      continue
    }

    const base = {
      run_id: run.id,
      design_id: run.design_id ?? null,
      design_name: run.snapshot?.design?.name ?? null,
      status: run.status ?? null,
    }

    if (run.status !== "completed") {
      reports.push({
        ...base,
        outcome: "skipped",
        reason: `This run is ${run.status}, not completed — there is no output to review yet.`,
      })
      continue
    }

    if (isDecided(run)) {
      reports.push({
        ...base,
        outcome: "skipped",
        reason: `Already ${run.approval_decision}.`,
        product_id: run.approved_product_id ?? null,
        variant_id: run.approved_variant_id ?? null,
      })
      continue
    }

    /**
     * A run with no design behind it (#1112 — the retail-fulfilment provenance
     * run) has nothing to make a product FROM. Rejecting it is still
     * meaningful, so only the approve path refuses it.
     */
    if (input.decision === "approve" && !run.design_id) {
      reports.push({
        ...base,
        outcome: "skipped",
        reason:
          "This run has no design behind it, so approval has nothing to create a product from.",
      })
      continue
    }

    eligible.push(run)
  }

  // ---- 2. Reject: record the decision, create nothing ---------------------
  if (input.decision === "reject") {
    for (const run of eligible) {
      const base = {
        run_id: run.id,
        design_id: run.design_id ?? null,
        design_name: run.snapshot?.design?.name ?? null,
        status: run.status ?? null,
      }

      if (!input.dryRun) {
        try {
          await runService.updateProductionRuns({
            id: run.id,
            approval_decision: "rejected",
            approval_decided_at: new Date(),
            approval_decided_by: input.actorId ?? "system",
            approval_reason: input.reason ?? null,
          })
        } catch (e: any) {
          reports.push({
            ...base,
            outcome: "failed",
            reason: e?.message ?? "Could not record the rejection.",
          })
          continue
        }
      }

      reports.push({ ...base, outcome: "rejected", reason: input.reason ?? undefined })
    }

    return summarise(input, reports, [])
  }

  // ---- 3. Approve: one product per DESIGN, however many runs --------------
  const storeCurrency = await readStoreCurrency(container)

  /** design_id → the runs of that design in this batch, in the order given. */
  const byDesign = new Map<string, any[]>()
  for (const run of eligible) {
    const list = byDesign.get(run.design_id) ?? []
    list.push(run)
    byDesign.set(run.design_id, list)
  }

  const createdProductIds: string[] = []

  for (const [designId, designRuns] of byDesign) {
    let product_id: string | null = null
    let variant_id: string | null = null
    let productExisted = false
    let currency = resolveApprovalCurrency({ storeCurrency })
    let price = 0

    try {
      const { data: designs = [] } = await query.graph({
        entity: "design",
        filters: { id: designId },
        fields: [
          "id",
          "name",
          "estimated_cost",
          "cost_currency",
          "products.id",
          "products.variants.id",
        ],
      })

      const design = designs?.[0]
      if (!design) {
        throw new Error(`Design not found: ${designId}`)
      }

      currency = resolveApprovalCurrency({
        designCurrency: design.cost_currency,
        storeCurrency,
      })
      price = Number(design.estimated_cost ?? 0) || 0

      const linked = design.products?.[0]
      productExisted = Boolean(linked?.id)

      if (productExisted) {
        /**
         * 🔴 THE idempotency rule. `create-product-from-design` would append
         * another `"Custom - <name>"` variant here, so a design with two
         * completed runs in one selection would be listed twice, silently.
         * The existing product IS the approval's output; it is recorded on
         * every run of the design and nothing is created.
         */
        product_id = linked.id
        variant_id = linked.variants?.[0]?.id ?? null
      } else if (!input.dryRun) {
        const { result } = await createProductFromDesignWorkflow(container).run({
          input: {
            design_id: designId,
            estimated_cost: price,
            currency_code: currency,
          },
        })
        product_id = result?.product_id ?? null
        variant_id = result?.variant_id ?? null
        if (product_id) createdProductIds.push(product_id)
      }

      if (!input.dryRun) {
        await updateDesignWorkflow(container).run({
          input: { id: designId, status: "Approved" },
        })

        for (const run of designRuns) {
          await runService.updateProductionRuns({
            id: run.id,
            approval_decision: "approved",
            approval_decided_at: new Date(),
            approval_decided_by: input.actorId ?? "system",
            approval_reason: input.reason ?? null,
            approved_product_id: product_id,
            approved_variant_id: variant_id,
          })
        }

        /**
         * 🔑 ONCE per design that newly gained a product — not once per run.
         * Partners are notified off `design.approved`, and a 40-run batch over
         * 5 designs must send 5 notifications, not 40. A design whose product
         * already existed is not newly approved and says nothing.
         */
        if (!productExisted && product_id) {
          try {
            const eventBus = container.resolve(
              Modules.EVENT_BUS
            ) as IEventBusModuleService
            await eventBus.emit({
              name: "design.approved",
              data: { design_id: designId, product_id, variant_id },
            })
          } catch {
            // Best-effort, exactly as the single-design route treats it.
          }
        }
      }

      for (const run of designRuns) {
        reports.push({
          run_id: run.id,
          design_id: designId,
          design_name: design.name ?? run.snapshot?.design?.name ?? null,
          status: run.status ?? null,
          outcome: "approved",
          product_id,
          variant_id,
          product_existed: productExisted,
          currency_code: currency,
          listed_price: price,
        })
      }
    } catch (e: any) {
      logger?.error?.(
        `[#1805] Approving design ${designId} failed: ${e?.message ?? e}`
      )
      /**
       * Isolated to this design's runs. One design whose product write fails
       * must not discard the decisions already made for the others — that is
       * the difference between a batch and a transaction, and a batch is what
       * an operator working a queue needs.
       */
      for (const run of designRuns) {
        reports.push({
          run_id: run.id,
          design_id: designId,
          design_name: run.snapshot?.design?.name ?? null,
          status: run.status ?? null,
          outcome: "failed",
          reason: e?.message ?? "Could not create the product for this design.",
        })
      }
    }
  }

  return summarise(input, reports, createdProductIds)
}

/** The counts an operator reads first, derived from the per-run rows. */
function summarise(
  input: { decision: RunApprovalDecision; dryRun?: boolean },
  reports: RunApprovalReport[],
  createdProductIds: string[]
): RunApprovalResult {
  const ids = (outcome: RunApprovalOutcome) =>
    reports.filter((r) => r.outcome === outcome).map((r) => r.run_id)

  return {
    decision: input.decision,
    dry_run: input.dryRun || undefined,
    runs: reports,
    design_ids: [
      ...new Set(
        reports
          .filter((r) => r.outcome === "approved" || r.outcome === "rejected")
          .map((r) => r.design_id)
          .filter((d): d is string => Boolean(d))
      ),
    ],
    created_product_ids: createdProductIds,
    approved: ids("approved"),
    rejected: ids("rejected"),
    skipped: ids("skipped"),
    failed: ids("failed"),
  }
}
