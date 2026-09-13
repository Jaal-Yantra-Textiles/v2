/**
 * Shared workflow steps for partner production run actions (start, finish, complete).
 *
 * These replace the inline route logic that previously violated the
 * Module → Workflow → API Route architecture pattern.
 */
import { ContainerRegistrationKeys, MedusaError, Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { logger } from "@medusajs/framework"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"
import { TASKS_MODULE } from "../../modules/tasks"
import {
  isAlreadySignalled,
  isMissingLifecycleTransaction,
} from "./lib/lifecycle-signal-errors"
import { lifecycleWorkflowId } from "./run-production-run-lifecycle"
import { resolveLineItemDesignId } from "../../lib/resolve-line-item-production"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartnerRunInput = {
  production_run_id: string
  partner_id: string
}

export type ResolvedPartnerLocation = {
  location_id: string | undefined
}

// ---------------------------------------------------------------------------
// Step: Retrieve & validate ownership + status
// ---------------------------------------------------------------------------

export type ValidateRunOpts = {
  /** Which lifecycle action is being attempted — picks the policy guard. */
  action: "start" | "finish" | "complete"
}

export const retrieveAndValidatePartnerRunStep = createStep(
  "retrieve-and-validate-partner-run",
  async (
    input: PartnerRunInput & { opts: ValidateRunOpts },
    { container }
  ) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)
    const productionPolicyService: ProductionPolicyService =
      container.resolve(PRODUCTION_POLICY_MODULE)

    const run = await productionRunService
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)

    if (!run || (run as any).partner_id !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }

    // Allowed transitions live in ONE place: ProductionPolicyService
    // (same authority the admin approve/dispatch/accept path uses).
    switch (input.opts.action) {
      case "start":
        await productionPolicyService.assertCanStartWork(run as any)
        break
      case "finish":
        await productionPolicyService.assertCanFinishWork(run as any)
        break
      case "complete":
        await productionPolicyService.assertCanCompleteWork(run as any)
        break
    }

    return new StepResponse(run)
  }
)

// ---------------------------------------------------------------------------
// Step: Transition design status (guarded)
// ---------------------------------------------------------------------------

export type TransitionDesignInput = {
  design_id: string | null
  target_status: string
  skip_statuses: string[]
}

export const transitionDesignStatusStep = createStep(
  "transition-design-status",
  async (input: TransitionDesignInput, { container }) => {
    if (!input.design_id) {
      return new StepResponse(
        { previous_status: null as string | null, skipped: true },
        null as { design_id: string; previous_status: string } | null
      )
    }

    const designService = container.resolve("design") as any
    const design = await designService.retrieveDesign(input.design_id)

    if (input.skip_statuses.includes(design.status)) {
      return new StepResponse(
        { previous_status: design.status as string | null, skipped: true },
        null as { design_id: string; previous_status: string } | null
      )
    }

    const previousStatus = design.status
    await designService.updateDesigns({
      id: input.design_id,
      status: input.target_status,
    })

    return new StepResponse(
      { previous_status: previousStatus as string | null, skipped: false },
      { design_id: input.design_id, previous_status: previousStatus } as { design_id: string; previous_status: string } | null
    )
  },
  // Compensation: restore previous design status
  async (rollbackData: { design_id: string; previous_status: string } | null, { container }) => {
    if (!rollbackData?.design_id) return
    const designService = container.resolve("design") as any
    await designService.updateDesigns({
      id: rollbackData.design_id,
      status: rollbackData.previous_status,
    })
  }
)

// ---------------------------------------------------------------------------
// Step: Signal lifecycle workflow step
// ---------------------------------------------------------------------------

export type SignalLifecycleInput = {
  lifecycle_transaction_id: string | null
  step_id: string
}

export const signalLifecycleStepStep = createStep(
  "signal-lifecycle-step",
  async (input: SignalLifecycleInput, { container }) => {
    if (!input.lifecycle_transaction_id) {
      return new StepResponse({ signaled: false })
    }

    const engineService = container.resolve(Modules.WORKFLOW_ENGINE) as any

    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: input.lifecycle_transaction_id,
          stepId: input.step_id,
          workflowId: lifecycleWorkflowId,
        },
        stepResponse: new StepResponse(true),
      })
    } catch (e: any) {
      const message = String(e?.message || "")

      // Step may already be completed — safe to ignore
      if (isAlreadySignalled(message)) {
        return new StepResponse({ signaled: false })
      }

      /**
       * The lifecycle transaction is GONE. Every await step carries a 23-day
       * timeout (`LIFECYCLE_TIMEOUT_SECONDS`), so a partner who takes longer
       * than that to finish a run finds the workflow expired underneath them.
       *
       * 🔴 Before this, the partner's action was LOST. The signal threw, the
       * whole finish workflow compensated, and `finished_at` rolled back to
       * null — leaving a run that is `in_progress` and live by every policy
       * guard, so the screen offers Finish again, forever. They also got the
       * raw framework string with an internal transaction id in it:
       * "Transaction <id> could not be found."
       *
       * Nothing is lost by carrying on. The lifecycle's only work after the
       * awaits is `cascadeCompletionStep`, and `complete-production-run`
       * already does that cascade INLINE precisely because it cannot depend on
       * the transaction being alive. So an expired lifecycle has nothing left
       * to do, and refusing the partner's finish buys nothing.
       *
       * ⚠️ Deliberately NOT a wider catch. Widening this to every error would
       * hide genuine signalling failures on runs whose transaction IS live —
       * the failure mode this guard exists to preserve. Only "the transaction
       * does not exist" is recoverable, and it is recoverable because there is
       * provably nothing on the other side of it. #1574
       */
      if (isMissingLifecycleTransaction(message)) {
        logger.warn(
          `[partner-run] lifecycle transaction ${input.lifecycle_transaction_id} for step ${input.step_id} is gone (expired or pruned) — recording the partner's action anyway: ${message}`
        )
        return new StepResponse({ signaled: false, lifecycle_expired: true })
      }

      throw e
    }

    return new StepResponse({ signaled: true })
  }
)

// ---------------------------------------------------------------------------
// Step: Emit production run event
// ---------------------------------------------------------------------------

export type EmitRunEventInput = {
  event_name: string
  data: Record<string, any>
}

export const emitProductionRunEventStep = createStep(
  "emit-production-run-event",
  async (input: EmitRunEventInput, { container }) => {
    const eventService = container.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{ name: input.event_name, data: input.data }])
    return new StepResponse({ emitted: true })
  }
)

// ---------------------------------------------------------------------------
// Step: Resolve partner's default stock location
// ---------------------------------------------------------------------------

export const resolvePartnerLocationStep = createStep(
  "resolve-partner-location",
  async (input: { partner_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    let locationId: string | undefined

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["stores.default_sales_channel_id"],
      filters: { id: input.partner_id },
    })

    const scId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
    if (scId) {
      const { data: channels } = await query.graph({
        entity: "sales_channels",
        fields: ["stock_locations.id"],
        filters: { id: scId },
      })
      locationId = channels?.[0]?.stock_locations?.[0]?.id
    }

    return new StepResponse({ location_id: locationId })
  }
)

// ---------------------------------------------------------------------------
// Step: Complete linked tasks
// ---------------------------------------------------------------------------

export const completeLinkedTasksStep = createStep(
  "complete-linked-tasks",
  async (input: { production_run_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const taskService = container.resolve(TASKS_MODULE) as any

    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["id", "tasks.id", "tasks.status", "tasks.title"],
      filters: { id: input.production_run_id },
    })

    const linkedTasks = ((runData?.[0] as any)?.tasks || []) as any[]
    const pendingTasks = linkedTasks.filter(
      (t: any) =>
        t?.id && !["completed", "cancelled"].includes(String(t.status || ""))
    )

    const completedTaskIds: string[] = []
    for (const t of pendingTasks) {
      await taskService.updateTasks({ id: t.id, status: "completed" })
      completedTaskIds.push(t.id)
    }

    return new StepResponse(
      { completed_count: completedTaskIds.length },
      { task_ids: completedTaskIds }
    )
  },
  // Compensation: restore tasks to in_progress
  async (rollbackData, { container }) => {
    if (!rollbackData?.task_ids?.length) return
    const taskService = container.resolve(TASKS_MODULE) as any
    for (const taskId of rollbackData.task_ids) {
      await taskService
        .updateTasks({ id: taskId, status: "in_progress" })
        .catch(() => {})
    }
  }
)

// ---------------------------------------------------------------------------
// Step: Stock finished goods at partner location
// ---------------------------------------------------------------------------

export type StockFinishedGoodsInput = {
  production_run_id: string
  design_id: string
  partner_id: string
  good_quantity: number
  location_id: string | undefined
  order_id: string | null
  order_line_item_id: string | null
  run_quantity: number
  /**
   * #1872 — the run's OWN variant, when it has one.
   *
   * `production_runs` has carried `variant_id` and `product_id` since it was
   * written, and nothing ever read them: this step re-derived the target from
   * `design_product_variant[0]` instead. A design with two variants would
   * therefore bank every customer's goods onto whichever variant came back
   * first. Prod has no such design today (#1871), which is why this has never
   * bitten — but #1874 is what makes a design able to accumulate variants, so
   * the two land together.
   */
  variant_id?: string | null
}

type StockRollbackData = {
  inventory_item_id: string
  location_id: string
  quantity: number
} | null

/**
 * What the step did, for #891 S1's audit record.
 *
 * `stocked: false` carries no location DELIBERATELY. The step returns early
 * for rejected-only output, for an aggregate parent, and for a design with no
 * resolvable variant — in every one of those the run has a `location_id` on
 * its input and banked nothing at it.
 */
export type StockFinishedGoodsResult = {
  stocked: boolean
  location_id?: string | null
  inventory_item_id?: string | null
  quantity?: number
}

export const stockFinishedGoodsStep = createStep(
  "stock-finished-goods",
  async (input: StockFinishedGoodsInput, { container }) => {
    if (input.good_quantity <= 0 || !input.location_id) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const inventoryService = container.resolve(Modules.INVENTORY) as any

    /**
     * A run with children is an AGGREGATE, not work (#1877). Its
     * `produced_quantity` is the rollup of children that each bank their own
     * output, so stocking it would count the same goods twice. The cascade in
     * `complete-production-run` completes a parent by a direct service update
     * and never runs this workflow for it — this guard is what makes that
     * property explicit rather than incidental, for anyone who completes a
     * parent directly.
     */
    const { data: children } = await query.graph({
      entity: "production_runs",
      filters: { parent_run_id: input.production_run_id },
      fields: ["id"],
    })
    if (children?.length) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    // The run's own variant wins; the design lookup is the fallback for the runs
    // that predate it (16 of 131 carry the column today).
    let variantId: string | undefined = input.variant_id ?? undefined

    if (!variantId) {
      const { data: designVariants } = await query.graph({
        entity: "design_product_variant",
        filters: { design_id: input.design_id },
        fields: ["product_variant_id"],
      })
      variantId = designVariants?.[0]?.product_variant_id
    }

    if (!variantId) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    const { data: variantInventory } = await query.graph({
      entity: "product_variant_inventory_item",
      filters: { variant_id: variantId },
      fields: ["inventory_item_id"],
    })

    const inventoryItemId = variantInventory?.[0]?.inventory_item_id
    if (!inventoryItemId) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    // Upsert inventory level
    const [existingLevel] = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: input.location_id,
    })

    if (existingLevel) {
      await inventoryService.updateInventoryLevels(existingLevel.id, {
        stocked_quantity: (existingLevel.stocked_quantity || 0) + input.good_quantity,
      })
    } else {
      await inventoryService.createInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: input.location_id,
        stocked_quantity: input.good_quantity,
      })
    }

    // Create reservation for the order if linked
    if (input.order_id) {
      let lineItemId = input.order_line_item_id
      if (!lineItemId) {
        const { data: orders } = await query.graph({
          entity: "order",
          filters: { id: input.order_id },
          fields: ["items.*"],
        })
        const items = orders?.[0]?.items || []
        /**
         * Was a `metadata.design_id` + `variant_id` match. Two problems: the
         * string is provenance and goes stale the moment an item is re-pointed
         * (#1921), and requiring `variant_id === variantId` cannot match a
         * design-order item, which has no variant at all — the same nullity
         * that made #1918's five items invisible.
         *
         * Resolve each item properly and prefer a variant match when one
         * exists, since a design with two variants must still bank onto the
         * right one. Falling back to a design match without a variant is what
         * lets a design-order item be reserved at all.
         */
        let designItem: any = null
        let designItemNoVariant: any = null
        for (const i of items) {
          const { designId: itemDesignId } = await resolveLineItemDesignId(
            query,
            { lineItemId: i.id, variantId: i.variant_id, metadata: i.metadata }
          )
          if (itemDesignId !== input.design_id) continue
          if (i.variant_id === variantId) {
            designItem = i
            break
          }
          if (!i.variant_id && !designItemNoVariant) {
            designItemNoVariant = i
          }
        }
        lineItemId = (designItem ?? designItemNoVariant)?.id
      }

      if (lineItemId) {
        const reservation = await inventoryService.createReservationItems({
          inventory_item_id: inventoryItemId,
          location_id: input.location_id,
          quantity: Math.min(input.good_quantity, input.run_quantity || input.good_quantity),
          line_item_id: lineItemId,
          description: `Reserved for order ${input.order_id} from production run ${input.production_run_id}`,
          // Still written (#2029 item 3). The link below is the typed home and
          // the reader prefers it, but every reservation created before this
          // change has only the blob, so it stays the fallback until those are
          // gone. Dual-write, per the #1554/#1557 model.
          metadata: {
            production_run_id: input.production_run_id,
            order_id: input.order_id,
          },
        })

        /**
         * The typed home for "this reservation belongs to that run" (#2029
         * item 3). Without it the receipt path has to list every reservation at
         * the location and filter on JSON in-app.
         *
         * ⚠️ Best-effort on purpose. The reservation is the thing that holds
         * stock; failing the whole stocking step because a link row could not
         * be written would leave finished goods unreserved to save an index.
         * The reader falls back to the blob, which is still written above, so a
         * missing link costs a scan and nothing else.
         */
        const reservationId = (reservation as any)?.id ?? (reservation as any)?.[0]?.id
        if (reservationId) {
          try {
            const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
            await remoteLink.create({
              [PRODUCTION_RUNS_MODULE]: { production_runs_id: input.production_run_id },
              [Modules.INVENTORY]: { reservation_item_id: reservationId },
            })
          } catch (e: any) {
            // Local name: `logger` is already imported at module scope here.
            const log: any = container.resolve(ContainerRegistrationKeys.LOGGER)
            log?.warn?.(
              `[stock-finished-goods] reservation ${reservationId} could not be linked to run ${input.production_run_id}: ${e?.message}`
            )
          }
        }
      }
    }

    return new StepResponse(
      {
        stocked: true,
        // #891 S1 — the step's own answer to "where did the goods go". Derived
        // here rather than re-derived by the caller: the early returns above
        // mean `input.location_id` being set is NOT the same as having stocked
        // anything, and a caller that assumed it would record a location for a
        // run that banked nothing.
        location_id: input.location_id,
        inventory_item_id: inventoryItemId,
        quantity: input.good_quantity,
      } as StockFinishedGoodsResult,
      { inventory_item_id: inventoryItemId, location_id: input.location_id, quantity: input.good_quantity } as StockRollbackData
    )
  },
  // Compensation: remove the stocked quantity
  async (rollbackData: StockRollbackData, { container }) => {
    if (!rollbackData?.inventory_item_id) return
    const inventoryService = container.resolve(Modules.INVENTORY) as any
    const [level] = await inventoryService.listInventoryLevels({
      inventory_item_id: rollbackData.inventory_item_id,
      location_id: rollbackData.location_id,
    })
    if (level) {
      try {
        await inventoryService.updateInventoryLevels(level.id, {
          stocked_quantity: Math.max(0, (level.stocked_quantity || 0) - rollbackData.quantity),
        })
      } catch (e: any) {
        // A compensation must not throw — it would mask the original failure and
        // leave the rest of the rollback undone. But it must not vanish either:
        // this swallowed a failed stock rollback silently, which leaves the
        // level carrying goods that were never produced and no trace of why
        // (#1259). Failing quietly is what made the last inventory drift take
        // four months to notice. Say it, then let the rollback continue.
        const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger?.error(
          `[stock-finished-goods] Rollback FAILED for ${rollbackData.inventory_item_id}@${rollbackData.location_id}: could not remove ${rollbackData.quantity}. The level is now overstated by that amount. ${e?.message}`
        )
      }
    }
  }
)

// ---------------------------------------------------------------------------
// Step: Record WHERE the run's output was banked (#891 S1)
// ---------------------------------------------------------------------------

export type RecordStockedLocationInput = {
  production_run_id: string
  /** The result of `stockFinishedGoodsStep`, passed straight through. */
  stock_result: StockFinishedGoodsResult
}

type RecordStockedLocationRollback = {
  production_run_id: string
  stocked_at_location_id: string | null
  stocked_quantity: number | null
  stocked_at: Date | null
} | null

/**
 * Stamp the stocked-at location onto the run.
 *
 * Pure audit: it changes no inventory, no money and no status. It exists
 * because the run was the one row that could not say where its own goods
 * went, which is what let a `+1` at the producing partner and a `-1` at the
 * house sit 84 minutes apart looking like a loss rather than a move.
 *
 * Best-effort on purpose. The goods are already banked and the partner is
 * already owed by the time this runs; failing the completion to save an audit
 * column would undo real work to protect a record of it. It logs loudly
 * instead — silence is what made the last inventory drift take four months to
 * notice (#1259).
 */
/**
 * What to stamp on the run, given what the stocking step actually did.
 *
 * Pure, and separate from the step, because this is the whole decision and the
 * step around it is plumbing. `null` means RECORD NOTHING.
 *
 * 🔑 The rule that matters: a location on the INPUT is not evidence that
 * anything was banked at it. `stockFinishedGoodsStep` returns early — with the
 * partner location still sitting on its input — for a run whose output was all
 * rejected, for an aggregate parent whose children bank their own goods, and
 * for a design with no resolvable variant. Recording the input location in any
 * of those cases would make the run claim goods at a place that received none,
 * which is the same false-split error, one layer up.
 */
export const stockedLocationRecordFor = (
  result: StockFinishedGoodsResult | null | undefined,
  now: Date = new Date()
): { stocked_at_location_id: string; stocked_quantity: number | null; stocked_at: Date } | null => {
  if (!result?.stocked) return null
  if (!result.location_id) return null
  return {
    stocked_at_location_id: String(result.location_id),
    // `?? null`, not `|| null`: a banked quantity of 0 should never reach here
    // (the step returns early on `good_quantity <= 0`), but if it ever does,
    // 0 is a number that was recorded, not an absence.
    stocked_quantity: result.quantity ?? null,
    stocked_at: now,
  }
}

export const recordStockedLocationStep = createStep(
  "record-stocked-location",
  async (input: RecordStockedLocationInput, { container }) => {
    // Nothing was banked — so there is no location to claim. Writing the
    // input location here anyway would assert that goods exist somewhere they
    // do not, which is the exact class of error S1 is meant to end.
    const record = stockedLocationRecordFor(input.stock_result)
    if (!record) {
      return new StepResponse(
        { recorded: false },
        null as RecordStockedLocationRollback
      )
    }

    const service: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    try {
      // Read the prior values BEFORE overwriting, so compensation restores
      // what was there rather than nulling a column a re-run had populated.
      const before: any = await service.retrieveProductionRun(
        input.production_run_id
      )

      await service.updateProductionRuns({
        id: input.production_run_id,
        ...record,
      } as any)

      return new StepResponse(
        { recorded: true, location_id: record.stocked_at_location_id },
        {
          production_run_id: input.production_run_id,
          stocked_at_location_id: before?.stocked_at_location_id ?? null,
          stocked_quantity: before?.stocked_quantity ?? null,
          stocked_at: before?.stocked_at ?? null,
        } as RecordStockedLocationRollback
      )
    } catch (e: any) {
      logger?.error(
        `[record-stocked-location] Could not stamp run ${input.production_run_id} as stocked at ${record.stocked_at_location_id}: ${e?.message}. The goods ARE banked there; only the record is missing, so this run's location will still have to be reconstructed.`
      )
      return new StepResponse(
        { recorded: false },
        null as RecordStockedLocationRollback
      )
    }
  },
  async (rollback: RecordStockedLocationRollback, { container }) => {
    if (!rollback?.production_run_id) return
    const service: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    try {
      await service.updateProductionRuns({
        id: rollback.production_run_id,
        stocked_at_location_id: rollback.stocked_at_location_id,
        stocked_quantity: rollback.stocked_quantity,
        stocked_at: rollback.stocked_at,
      } as any)
    } catch (e: any) {
      // A compensation must not throw — it would mask the original failure.
      logger?.error(
        `[record-stocked-location] Rollback FAILED for run ${rollback.production_run_id}: the run still claims stock at ${rollback.stocked_at_location_id ?? "(none)"}. ${e?.message}`
      )
    }
  }
)
