import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { computeRunCostSummary } from "../../modules/production_runs/cost-summary"
import { requestVariantPriceFanout } from "../fx/fanout-variant-prices"
import {
  resolveApprovalCurrency as resolveCurrency,
  approvalCurrencyWasAssumed as assumedCurrency,
  resolveApprovalPrice,
} from "./approval-pricing"
import {
  resolveDesignGallery,
  resolveRunsSizeLabel,
} from "../designs/create-product-from-design"
import { applyDesignProductPlan } from "../designs/design-product-plan"
import {
  buildLineBindingPayload,
  planOrderLineBindings,
} from "./lib/plan-order-line-binding"
import updateDesignWorkflow from "../designs/update-design"
import {
  resolveDesignApprovalTarget,
  describeApprovalTarget,
  resolveRunApprovalStamp,
  indexVariantOwners,
  diffApprovalTarget,
  type ApprovalReconcile,
} from "./lib/run-variant"

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
 * design's own `cost_currency` is the answer, with INR behind it. The store
 * default is NOT consulted — on a EUR store it made the INR last resort
 * unreachable and minted INR costs as euros, ~110x (#1979). See
 * `resolveApprovalCurrency`.
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
   *
   * Kept alongside `reconcile` because callers read it — the admin approval
   * surface and the MCP tool both key off it. It is the same boolean; the diff
   * is what it could never say.
   */
  product_existed?: boolean
  /**
   * What this approval actually changed, where the boolean could only say
   * "a product was already there": whether the VARIANT was reused or could not
   * be named at all, and whether the price on sale still matches the one just
   * computed. See `diffApprovalTarget`.
   */
  reconcile?: ApprovalReconcile
  /** Where this run's `approved_variant_id` came from: run | design | none. */
  variant_source?: "run" | "design" | "none"
  currency_code?: string
  listed_price?: number
  /** Which cost the listed price was derived from: run_cost | design_estimate. */
  price_source?: string | null
  /** The pre-markup cost per unit behind `listed_price`. */
  unit_cost?: number | null
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
 * The currency and the price rule both live in `approval-pricing.ts` now — one
 * definition, exercised without a container. Re-exported here because the
 * design approve route and this workflow's own spec import it from this module,
 * and a second copy of a money rule is how two surfaces start disagreeing.
 */
export {
  APPROVAL_MARKUP,
  resolveApprovalCurrency,
  resolveApprovalPrice,
} from "./approval-pricing"
import { loadCostConfig } from "../../modules/platform-cost-config/read-config"
import { currencyIsSellable, readHouseStore } from "./house-store"

/**
 * The store the FX fanout is scoped to — the HOUSE store, not `stores[0]`.
 *
 * 🔴 This used to take the first row of a 13-row, multi-tenant table, so the
 * fanout could be scoped to an arbitrary partner tenant's currency set (#1979).
 * See `house-store.ts` for how the house store is identified and why an
 * ambiguous answer returns null rather than guessing.
 */
export async function readStoreId(container: any): Promise<string | null> {
  return (await readHouseStore(container))?.id ?? null
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
  /**
   * The FX fanout is scoped to a store's `supported_currencies`, so it needs the
   * store id — read once here rather than per design. A store we cannot read
   * costs the fanout, not the approval: the base price is still written and
   * `replay-fx-fanout` can materialise the rest later.
   */
  const houseStore = await readHouseStore(container)
  const storeId = houseStore?.id ?? null
  const costConfig = await loadCostConfig(container)

  /** design_id → the runs of that design in this batch, in the order given. */
  const byDesign = new Map<string, any[]>()
  for (const run of eligible) {
    const list = byDesign.get(run.design_id) ?? []
    list.push(run)
    byDesign.set(run.design_id, list)
  }

  const createdProductIds: string[] = []
  /**
   * 🔑 ONE fanout for the whole batch, not one per design.
   *
   * `requestVariantPriceFanout` emits a job per call. A 40-run batch over 5
   * designs used to emit 5, each waking the worker to do the same
   * currency-by-currency walk. The workflow already skips currencies a
   * price_set carries, so batching changes nothing about the result — only how
   * many times the worker is asked. Requested AFTER the loop so a design that
   * throws does not take the other designs' fanout down with it.
   */
  const fanoutVariantIds: string[] = []

  for (const [designId, designRuns] of byDesign) {
    let product_id: string | null = null
    let variant_id: string | null = null
    let productExisted = false
    /** Why the approval could not name a variant, when it could not. */
    let targetNote: string | null = null
    /** variant id -> owning product, from this design's own read. */
    let variantOwner = new Map<string, string>()
    /** What this approval changed — see `diffApprovalTarget`. */
    let reconcile: ApprovalReconcile | null = null
    /**
     * The pre-read default, used only if the design read below throws. INR
     * rather than the store's default: production is costed in INR, and a EUR
     * store default here is what made #1979 a 110x overprice.
     */
    let currency = resolveCurrency({})
    let price = 0
    let priceSource: string | null = null
    let unitCost: number | null = null

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
          // What is ALREADY listed, so a re-approval can say whether the price
          // it just computed still agrees with the one on sale (`price_stale`).
          "products.variants.prices.amount",
          "products.variants.prices.currency_code",
          // #1920 — the photoshoot evidence. Commerce_Ready means "we could
          // SELL this", and a garment with no photographs cannot be sold.
          "folders.id",
          "folders.media_files.id",
          "folders.media_files.file_path",
          "folders.media_files.file_type",
          "folders.media_files.mime_type",
        ],
      })

      const design = designs?.[0]
      if (!design) {
        throw new Error(`Design not found: ${designId}`)
      }

      /**
       * 🔴 The price comes from what the RUN cost, not from an estimate typed
       * on the design months earlier — and never from `?? 0`.
       *
       * `computeRunCostSummary` derives `cost_per_unit` from real consumption
       * logs (material, energy, labour, partner estimate). A run with no logs
       * has `null` there and the design's estimate answers instead; a design
       * with neither is REFUSED below rather than listed at zero, because a
       * price of 0 is a claim and #1900 caught one on the storefront.
       *
       * Costed per run and reduced to the DEAREST, because the product is one
       * listing for every run of the design: pricing off the cheapest run
       * would under-price every other unit sold under the same variant.
       */
      let runCostPerUnit: number | null = null
      /**
       * 🔴 The currency of the run that SUPPLIED the winning cost — not of any
       * run in the batch. Reducing to the dearest picks one record's number, so
       * the denomination has to come from that same record or the price is
       * valued by one run and labelled by another.
       */
      let costingRunCurrency: string | null = null
      for (const r of designRuns) {
        try {
          const summary = await computeRunCostSummary(container, r.id)
          const perUnit = Number(summary?.cost_per_unit)
          if (Number.isFinite(perUnit) && perUnit > 0 && perUnit > (runCostPerUnit ?? 0)) {
            runCostPerUnit = perUnit
            costingRunCurrency = summary?.currency ?? null
          }
        } catch {
          // A run we cannot cost is not a reason to fail the batch; the other
          // runs and the design's estimate still answer.
        }
      }

      /**
       * #1939 — the approval markup, read rather than compiled. Against the
       * seeded row (1.4) this is a no-op; the compiled `APPROVAL_MARKUP`
       * answers for an unconfigured platform.
       */
      const priced = resolveApprovalPrice({
        runCostPerUnit,
        designEstimatedCost: Number(design.estimated_cost ?? 0),
        markup: costConfig.approval_markup_multiplier ?? undefined,
      })
      if (!priced) {
        throw new Error(
          `Cannot price design ${designId}: no run of it has a costed ` +
            `consumption log and the design has no estimated_cost. Record ` +
            `consumption or set an estimate — approving would list it at 0.`
        )
      }
      price = priced.price
      priceSource = priced.source
      unitCost = priced.cost

      /**
       * Denominate the price with the record that SUPPLIED it.
       *
       * 🔴 Resolved AFTER pricing, deliberately. `resolveApprovalPrice` picks
       * the run's cost where one exists and the design's estimate where it does
       * not — so the currency has to follow the same choice. Asking the run for
       * the currency of a figure that came off the DESIGN would label an
       * estimate with a denomination it was never expressed in.
       */
      const runCurrencyForPrice =
        priceSource === "run_cost" ? costingRunCurrency : null
      currency = resolveCurrency({
        runCurrency: runCurrencyForPrice,
        designCurrency: design.cost_currency,
      })
      if (assumedCurrency(design.cost_currency, runCurrencyForPrice)) {

        /**
         * Said out loud because it is a GUESS, and the common case: 42 of 43
         * costed designs on prod had no `cost_currency` when #1979 was found.
         * The price is still written — refusing the batch over it would stop
         * approvals platform-wide — but the assumption is now in the log
         * rather than only in a docblock.
         */
        logger?.warn?.(
          `[approve-run-output] design ${designId} has no cost_currency; ` +
            `assuming ${currency}. If it was not costed in ${currency}, its price is wrong.`
        )
      }
      if (!currencyIsSellable(currency, houseStore)) {
        /**
         * A GUARD, never an override. The currency stays what the cost was
         * computed in — re-denominating it to whatever the store prefers is
         * exactly the #1979 defect. This only says the resulting price is not
         * sellable here, so it stops being a silent condition: on prod today
         * INR is enabled on 12 of 13 stores, but `Le Ciricotte` does not
         * enable it at all.
         */
        logger?.warn?.(
          `[approve-run-output] design ${designId} is priced in ${currency}, ` +
            `which the house store does not sell in ` +
            `(enabled: ${houseStore?.currencies.join(", ") || "unknown"}). ` +
            `The price is correct but unsellable until ${currency} is enabled.`
        )
      }


      const linkedProducts = (design.products ?? []) as Array<any>
      productExisted = linkedProducts.some((p: any) => Boolean(p?.id))
      variantOwner = indexVariantOwners(linkedProducts)

      if (productExisted) {
        /**
         * 🔴 THE idempotency rule. `create-product-from-design` would append
         * another `"Custom - <name>"` variant here, so a design with two
         * completed runs in one selection would be listed twice, silently.
         * The existing product IS the approval's output; it is recorded on
         * every run of the design and nothing is created.
         *
         * 🔴 WHICH variant, though, is not `products[0].variants[0]` — that is
         * the PRODUCT's first variant, and a product minted from one design and
         * appended to by another carries one variant per design. Row 0 is then
         * another design's garment, stamped onto this run as
         * `approved_variant_id` and fulfilled against later. See
         * `resolveDesignApprovalTarget`: the runs' own `variant_id` answers
         * first, the design↔variant link second, and an ambiguous answer is
         * refused rather than guessed.
         */
        const target = await resolveDesignApprovalTarget(container, {
          designId,
          runs: designRuns,
          linkedProducts,
        })
        product_id = target.product_id
        variant_id = target.variant_id
        if (target.reason) {
          /**
           * Said out loud on every one of the design's runs, because a null
           * `approved_variant_id` is otherwise indistinguishable from a design
           * that was never minted — and the repair (stamp the run's variant_id)
           * is something only a human knows the answer to.
           */
          targetNote = describeApprovalTarget(designId, target)
          logger?.warn?.(`[approve-run-output] ${targetNote}`)
        }
      } else if (!input.dryRun) {
        const result = await applyDesignProductPlan(container, {
            design_id: designId,
            estimated_cost: price,
            currency_code: currency,
            /**
             * 🔑 #2030 item 3 — the RUNS' size, which beats the design's.
             *
             * The design can state S and M; the run being approved made one of
             * them, and its snapshot records which. Order 89 is exactly that
             * shape (design [S, M], run [M]), and the design-level rule
             * abstains on it — correctly, because the design really is
             * ambiguous. The run is not.
             *
             * Resolved across the whole batch, because this mints per
             * DESIGN: runs that disagree abstain, and a run that names no
             * single size contributes nothing rather than blocking the rest.
             * `snapshot` is each run's own captured copy, so this reads what
             * was true when the work was commissioned, not what the design
             * says today.
             */
            size_label: resolveRunsSizeLabel(designRuns),
        })
        product_id = result?.product_id ?? null
        variant_id = result?.variant_id ?? null
        if (product_id) createdProductIds.push(product_id)

        /**
         * 🔴 Materialise the other currencies. Medusa's pricing module emits no
         * `price.created` event, so every path that writes a variant price has
         * to ASK for the fanout itself — and only the partner routes ever did.
         * The design -> product path (this one) emitted nothing, so every
         * design-approved product has been listed in exactly one currency and
         * reads as "not available" in every other region. That is #1900's
         * single-currency defect, and it was never a fault in the FX code.
         *
         * Requested, not run inline: the handler is a subscriber so the work
         * lands on the WORKER. Running this fanout on the request path
         * OOM-killed prod twice on 2026-08-19 (exit 137). `requestVariantPriceFanout`
         * never throws, and the workflow skips currencies a price_set already
         * carries, so a re-approval is idempotent.
         */
        if (variant_id) fanoutVariantIds.push(variant_id)
      }

      /**
       * 🔴 Per RUN, not per design. `resolveDesignApprovalTarget` refuses with
       * a null variant when two runs of one design made DIFFERENT variants —
       * and that refusal used to null `approved_variant_id` on both of them,
       * including runs that said exactly what they produced. #1970 is explicit
       * that the order binding is per run, and `describeApprovalTarget`'s own
       * `runs_disagree` text already pointed here.
       */
      const stamps = new Map(
        designRuns.map((run: any) => [
          run.id,
          resolveRunApprovalStamp(run, { product_id, variant_id }, variantOwner),
        ])
      )

      /**
       * What changed, computed once for the design. The prices come from the
       * design read above, so this costs no extra query.
       */
      const listedPrices = variant_id
        ? ((linkedProducts
            .flatMap((prod: any) => prod?.variants ?? [])
            .find((v: any) => v?.id === variant_id)?.prices ?? []) as Array<any>)
        : []
      reconcile = diffApprovalTarget({
        productExisted,
        productId: product_id,
        variantId: variant_id,
        computedPrice: price,
        currency,
        existingPrices: listedPrices,
      })

      /**
       * A price that moved and was NOT rewritten. Re-approving does not
       * reprice a product that may already be selling, but computing a
       * different number and discarding it silently is how the stale one
       * survives a re-approval that looked like it agreed.
       */
      if (reconcile.price_stale) {
        logger?.warn?.(
          `[approve-run-output] design ${designId} is listed at ` +
            `${reconcile.listed_price_before} ${currency} but this approval computed ` +
            `${price} ${currency}. The listing was NOT repriced — change it deliberately.`
        )
      }

      if (!input.dryRun) {
        /**
         * `Commerce_Ready` only once the PHOTOS EXIST (#1920).
         *
         * Approving run output is the moment a design has been PRODUCED and
         * a real product minted from it a few lines above. That is most of
         * what `Commerce_Ready` means — but not all of it. In practice a
         * produced garment is not sellable until it has been PHOTOGRAPHED,
         * and the shoot happens after the goods exist. Approval alone would
         * mark designs sellable that have no image to sell them with.
         *
         * So the shoot is the gate, and the evidence for it is the design's
         * linked media folder holding at least one image — the same folder
         * `resolveDesignGallery` draws the product's gallery from. Evidence,
         * not a checkbox: a task ticked with no photographs behind it is a
         * claim, and this asks the artefact instead.
         *
         * No photos yet → `Approved`, exactly as before, and the design waits
         * for the shoot. Nothing regresses; the transition is only ADDED where
         * it is earned.
         *
         * Nothing ever set `Commerce_Ready` at all — the only writer was a
         * subscriber on `design.updated`, an event this codebase does not
         * emit, which is why 0 of 123 prod designs had ever reached it.
         *
         * Safe against every gate that names `Approved`, all of which name
         * `Commerce_Ready` too: `create-payment-submission`'s ELIGIBLE_STATUSES,
         * the skip lists in `complete-production-run` / `finish-production-run`,
         * and REVISABLE_STATUSES in both revise files. A design does not become
         * unrevisable or unbillable by getting here.
         *
         * 🔑 It does NOT publish the product. The mint above is still `draft`,
         * deliberately: producing a commission does not decide that we want to
         * SELL it to other people. `Commerce_Ready` marks eligibility, and
         * listing it stays a human choice.
         */
        const hasPhotos = resolveDesignGallery(design).images.length > 0

        await updateDesignWorkflow(container).run({
          input: {
            id: designId,
            status: hasPhotos ? "Commerce_Ready" : "Approved",
          },
        })

        for (const run of designRuns) {
          const stamp = stamps.get(run.id)!
          await runService.updateProductionRuns({
            id: run.id,
            approval_decision: "approved",
            approval_decided_at: new Date(),
            approval_decided_by: input.actorId ?? "system",
            approval_reason: input.reason ?? null,
            approved_product_id: stamp.product_id,
            approved_variant_id: stamp.variant_id,
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
        const stamp = stamps.get(run.id)!
        reports.push({
          run_id: run.id,
          design_id: designId,
          design_name: design.name ?? run.snapshot?.design?.name ?? null,
          status: run.status ?? null,
          outcome: "approved",
          /**
           * A run that answered for itself is not suffering the design's
           * ambiguity, so it does not carry the design's refusal note.
           */
          reason: stamp.source === "run" ? undefined : targetNote ?? undefined,
          product_id: stamp.product_id,
          variant_id: stamp.variant_id,
          product_existed: productExisted,
          reconcile: reconcile ?? undefined,
          variant_source: stamp.source,
          currency_code: currency,
          listed_price: price,
          price_source: priceSource,
          unit_cost: unitCost,
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

  /**
   * One fanout for every variant this call minted (see `fanoutVariantIds`).
   *
   * Still requested rather than run inline: the handler is a subscriber, so the
   * currency walk lands on the WORKER. Doing it on the request path OOM-killed
   * prod twice on 2026-08-19 (exit 137). `requestVariantPriceFanout` never
   * throws, and the workflow skips currencies a price_set already carries, so
   * this stays idempotent across a re-approval.
   *
   * A store we could not read costs the fanout, not the approval — the base
   * price is written either way and `replay-fx-fanout` can materialise the
   * rest later.
   */
  if (fanoutVariantIds.length && storeId) {
    await requestVariantPriceFanout(container, {
      storeId,
      variantIds: [...new Set(fanoutVariantIds)],
    })
  }

  /**
   * #1970 item 2 — bind each approved run's PAID ORDER LINE to the variant the
   * approval just named.
   *
   * `create-product-from-design` already does this, but only on the mint path,
   * which approval reaches exclusively in the `!productExisted` branch. Every
   * design whose product already existed — a second run, a re-approval —
   * stamped the run and left the paid line with `variant_id: null` forever.
   *
   * Runs LAST, and non-fatally: the approval decision is already durable by
   * this point, and a failure to reach the order module must not un-approve
   * work that was genuinely approved. A line left unbound is recoverable; a
   * lost approval is not.
   */
  if (!input.dryRun) {
    try {
      await bindApprovedRunsToOrderLines(container, reports, logger)
    } catch (e: any) {
      logger?.warn?.(
        `[approve-run-output] #1970 order-line binding failed: ${e?.message ?? e}`
      )
    }

    /**
     * #891 (2026-09-13) — approval is what lets a goods transfer post.
     *
     * Partner completion is a CLAIM; this is the ACCEPTANCE of it, and stock
     * must not enter our books on an unaccepted claim. A transfer received
     * before now was recorded but moved nothing (`planTransferMove`'s
     * `unapproved_run`), and its `inventory_posted_at` is still null. This is
     * the second half of that pair: whichever of receipt and approval happens
     * LAST performs the movement.
     *
     * Non-fatal and last, for the same reason as the binding above: the
     * approval decision is already durable, and an unposted transfer is
     * recoverable — a lost approval is not. It is also idempotent, so a retry
     * or a re-approval posts nothing twice.
     */
    for (const runId of [...new Set(reports.filter((r) => r.outcome === "approved").map((r) => r.run_id))]) {
      try {
        /**
         * 🔴 Imported LAZILY, on purpose. `receive-goods-transfer` pulls in
         * `production-run-reservations-link`, and `defineLink(...)` THROWS at
         * module-evaluation time outside a running Medusa container
         * (`linkable` is undefined). A top-level import here took down
         * `approve-run-output.unit.spec.ts` entirely — the suite failed to
         * LOAD, which jest reports as a failed suite with 0 tests, next to a
         * cheerful "50 passed" from the other files in the same run.
         *
         * Deferring it to call time keeps the link out of every importer's
         * module graph while changing nothing at runtime, where the container
         * exists by definition.
         */
        const { postPendingTransfersForRun } = await import(
          // `.js`, not `.ts`: this package compiles under nodenext module
          // resolution, where a relative specifier must name the EMITTED file.
          "./receive-goods-transfer.js"
        )
        const { posted, skipped } = await postPendingTransfersForRun(container, runId)
        if (posted || skipped) {
          logger?.info?.(
            `[approve-run-output] #891 run ${runId}: posted ${posted} deferred transfer(s), skipped ${skipped}`
          )
        }
      } catch (e: any) {
        logger?.warn?.(
          `[approve-run-output] #891 deferred transfer posting failed for run ${runId}: ${e?.message ?? e}`
        )
      }
    }
  }

  return summarise(input, reports, createdProductIds)
}

/**
 * #1970 item 2 — the write half. Reads the just-decided runs back for their
 * `order_line_item_id`, plans the bindings (pure, in `plan-order-line-binding`),
 * and fills in ONLY a missing variant.
 *
 * 🔴 THE MONEY INVARIANT. The payload carries no price field — see
 * `buildLineBindingPayload`. The paid line's `unit_price` is what the customer
 * was quoted at checkout; the approval price is a different number computed
 * from run cost × markup. This function exists to connect a line to a variant,
 * never to reprice one. The order total is read before and after and a drift is
 * shouted about rather than swallowed, because a silent reprice of a captured
 * order is the worst thing this file could do.
 */
async function bindApprovedRunsToOrderLines(
  container: any,
  reports: RunApprovalReport[],
  logger: any
): Promise<void> {
  const approvedRunIds = reports
    .filter((r) => r.outcome === "approved")
    .map((r) => r.run_id)

  if (!approvedRunIds.length) return

  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const orderService: any = container.resolve(Modules.ORDER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // Re-read: the stamps were written above, so these rows now carry
  // `approved_variant_id`. Same guard as the top of this file — never call the
  // service with an empty id list.
  const decided: any[] = await runService.listProductionRuns({ id: approvedRunIds })

  const lineIds = [
    ...new Set(
      decided
        .map((r: any) => r?.order_line_item_id)
        .filter((id: any): id is string => typeof id === "string" && !!id)
    ),
  ]
  if (!lineIds.length) return

  const lines: any[] = await orderService.listOrderLineItems({ id: lineIds })
  const lineById = new Map<string, any>(
    (lines || []).map((l: any) => [l.id, l])
  )

  const { bind, skip } = planOrderLineBindings(decided, lineById)

  for (const s of skip) {
    if (s.reason === "no_order_line") continue // ordinary: no customer behind it
    logger?.info?.(
      `[approve-run-output] #1970 not binding run ${s.run_id} to line ${s.line_item_id}: ${s.reason}`
    )
  }

  if (!bind.length) return

  /**
   * The totals BEFORE, per order. Read from the order module rather than summed
   * from the lines, because the total is what the customer owes and what the
   * payment captured — a recomputation of our own would be checking this code
   * against itself.
   */
  const orderIds = [
    ...new Set(bind.map((b) => b.order_id).filter((id): id is string => !!id)),
  ]
  const totalsBefore = await readOrderTotals(query, orderIds)

  for (const binding of bind) {
    try {
      let variantDetails: any = null
      try {
        const { data } = await query.graph({
          entity: "variant",
          fields: ["id", "sku", "title", "product.title"],
          filters: { id: binding.variant_id },
        })
        variantDetails = (data || [])[0] ?? null
      } catch {
        // Cosmetic fields only — the binding is the variant_id.
      }

      await orderService.updateOrderLineItems(
        binding.line_item_id,
        buildLineBindingPayload(binding, variantDetails)
      )

      logger?.info?.(
        `[approve-run-output] #1970 bound paid line ${binding.line_item_id} to variant ${binding.variant_id} (run ${binding.run_id})`
      )
    } catch (e: any) {
      logger?.warn?.(
        `[approve-run-output] #1970 could not bind line ${binding.line_item_id}: ${e?.message ?? e}`
      )
    }
  }

  /**
   * 🔴 Read the row back. A write that reports success may persist nothing, and
   * here the failure mode that matters is the opposite one: a write that
   * persisted MORE than it said. If any order's total moved, say so loudly —
   * it means a binding repriced a captured order, and somebody must look.
   */
  const totalsAfter = await readOrderTotals(query, orderIds)
  for (const [orderId, before] of totalsBefore) {
    const after = totalsAfter.get(orderId)
    if (after !== undefined && before !== undefined && after !== before) {
      logger?.error?.(
        `[approve-run-output] 🔴 #1970 ORDER TOTAL MOVED on ${orderId}: ${before} → ${after}. ` +
          `Binding a paid line to a variant must never reprice it.`
      )
    }
  }
}

/** Order id → current total, for the invariant check above. */
async function readOrderTotals(
  query: any,
  orderIds: string[]
): Promise<Map<string, number | undefined>> {
  const totals = new Map<string, number | undefined>()
  if (!orderIds.length) return totals
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "total"],
      filters: { id: orderIds },
    })
    for (const o of data || []) totals.set(o.id, o?.total)
  } catch {
    // Unknowable is not the same as unchanged — an absent entry is skipped by
    // the comparison above rather than read as "no drift".
  }
  return totals
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
