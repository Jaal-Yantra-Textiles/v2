import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Checkbox,
  CommandBar,
  Container,
  Input,
  Table,
  Text,
  Textarea,
  Tooltip,
  toast,
} from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerAssignedTasks,
  type PartnerAssignedTask,
} from "../../../hooks/api/partner-assigned-tasks"
import { useCreatePartnerPaymentSubmission } from "../../../hooks/api/partner-payment-submissions"
import {
  usePartnerPayableRuns,
  type PayableRun,
} from "../../../hooks/api/partner-payable-runs"
import {
  usePartnerPayableInventoryOrders,
  type PayableInventoryOrder,
} from "../../../hooks/api/partner-payable-inventory-orders"
import {
  groupIntoRateBands,
  runBillsVerbatimTotal,
  runLineAmount,
  runNeedsTypedPrice,
} from "../../../lib/payment-submission-money"

const ELIGIBLE_TASK_STATUSES = ["completed"]

const getRunUnitCost = (run: PayableRun): number => run.unit_amount

const getTaskCost = (t: PartnerAssignedTask): number =>
  Number(t.actual_cost ?? t.estimated_cost ?? 0)

export const PaymentSubmissionCreate = () => {
  const navigate = useNavigate()
  /**
   * One table of payable WORK, filtered — not a tab per source.
   *
   * A partner is answering "what am I owed for?", and the answer is a mix: runs
   * they finished and tasks they did. Splitting that across tabs made the total
   * in the header the only place the two were ever added up, so the screen
   * could show "0 items" on the tab you were looking at while you had picks on
   * the other one.
   *
   * Tasks are NOT redundant with runs. Most hang off a run, but a partner can
   * hold standalone ones, and this screen is the only place they can be billed.
   */
  const [typeFilter, setTypeFilter] = useState<
    "all" | "runs" | "tasks" | "orders"
  >("all")
  /** Reveal the rows that cannot be submitted, greyed out, with the reason. */
  const [showSubmitted, setShowSubmitted] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [runQuantities, setRunQuantities] = useState<Record<string, number>>({})
  const [runUnitAmounts, setRunUnitAmounts] = useState<Record<string, number>>({})
  const [taskCostOverrides, setTaskCostOverrides] = useState<
    Record<string, number>
  >({})
  /**
   * GOODS this partner delivered (#1710) — material we bought FROM them, as
   * opposed to work they did for us.
   *
   * 🔴 Until now a partner could bill only for work. The one self-serve path
   * for goods was "Submit Payment" on the inventory order, which records an
   * `internal_payments` row that is NOT a claim and that no payout accounts
   * for — money that then sat invisible to the partner ledger entirely.
   */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set()
  )
  const [orderAmountOverrides, setOrderAmountOverrides] = useState<
    Record<string, number>
  >({})
  const [notes, setNotes] = useState("")

  // Fetch payable runs, tasks and inventory orders in parallel
  const { payable_runs = [], isPending: runsLoading } = usePartnerPayableRuns()
  const { tasks = [], isPending: tasksLoading } = usePartnerAssignedTasks()
  const {
    payable_inventory_orders = [],
    isPending: ordersLoading,
  } = usePartnerPayableInventoryOrders()

  /**
   * Why a run cannot be submitted right now, or null when it can.
   *
   * 🔴 `design_has_open_submission` is the one that used to get through. The
   * endpoint computes it and this screen never read it, so a run whose design
   * already sits in an open submission was offered, selected, and submitted —
   * and the workflow refused the whole request with "Designs already in an
   * active payment submission". A partner could not tell which row caused it,
   * because nothing on the screen said any row was different.
   *
   * A payment line is keyed by DESIGN, so the block is per design, not per run:
   * a second run of the same design is unbillable until the first submission is
   * resolved, however clean that run looks on its own.
   */
  const runBlockedReason = useCallback(
    (r: PayableRun): string | null => {
      /**
       * ⚠️ `billed` blocks; `partly_billed` deliberately does NOT (#1596). A
       * run claimed for 4 of the 9 it was ordered for still has 5 units the
       * write guard will accept, and reporting that as "already paid" is what
       * left the last pieces of a short-completed run unbillable through any
       * screen — the workflow said yes and no screen would ask.
       */
      if (r.billing_status === "billed") {
        return r.billed?.submission_id
          ? `Already paid · ${r.billed.submission_id}`
          : "Already paid"
      }
      if (r.design_has_open_submission) {
        return "This design is already in an open submission"
      }
      return null
    },
    []
  )

  const submittableRuns = useMemo(
    () => payable_runs.filter((r: PayableRun) => !runBlockedReason(r)),
    [payable_runs, runBlockedReason]
  )

  const blockedRuns = useMemo(
    () => payable_runs.filter((r: PayableRun) => !!runBlockedReason(r)),
    [payable_runs, runBlockedReason]
  )

  /**
   * Only the submittable rows may ever be selected. Everything downstream —
   * totals, validation, the payload — reads this, so a blocked row cannot reach
   * the request even if it is on screen.
   */
  const eligibleRuns = submittableRuns

  const eligibleTasks = useMemo(
    () =>
      tasks.filter(
        (t: PartnerAssignedTask) =>
          ELIGIBLE_TASK_STATUSES.includes(t.status || "") &&
          !t.parent_task_id // submit standalone/parent tasks only, not subtasks
      ),
    [tasks]
  )

  /**
   * Why an inventory order cannot be billed right now, or null when it can.
   *
   * 🔑 The server already decided this — `payable` is false when there is
   * nothing left, and `remaining` says how much headroom is left against the
   * ORDERED total. The screen must not re-derive it: a screen that computes its
   * own answer offers figures the write guard then refuses, and the partner
   * learns the rule from a 400 (#1617).
   */
  const orderBlockedReason = useCallback(
    (o: PayableInventoryOrder): string | null => {
      if (o.payable) return null
      if (o.remaining != null && o.remaining <= 0) {
        return o.claims.length
          ? `Already billed · ${o.claims[0].submission_id ?? "open submission"}`
          : "Already fully billed"
      }
      /**
       * ⚠️ No receipts is a GAP IN THE RECORD, not a price of zero. Saying so
       * is the difference between a partner chasing the delivery note and a
       * partner concluding we think the goods were free.
       */
      return "No delivery recorded against this order yet"
    },
    []
  )

  const eligibleOrders = useMemo(
    () =>
      payable_inventory_orders.filter(
        (o: PayableInventoryOrder) => !orderBlockedReason(o)
      ),
    [payable_inventory_orders, orderBlockedReason]
  )

  const blockedOrders = useMemo(
    () =>
      payable_inventory_orders.filter(
        (o: PayableInventoryOrder) => !!orderBlockedReason(o)
      ),
    [payable_inventory_orders, orderBlockedReason]
  )

  const { mutateAsync: createSubmission, isPending: isCreating } =
    useCreatePartnerPaymentSubmission()

  // ─── Selection handlers ─────────────────────────────────────────────
  const toggleRun = useCallback((id: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleOrder = useCallback((id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /**
   * Select-all acts on what is ON SCREEN, not on everything selectable.
   *
   * There used to be one per tab. With a single filtered table that would be a
   * trap: pressing it while filtered to Tasks and having it also tick every run
   * would bill work the partner never looked at, and the command bar total is
   * the only place they would notice.
   */
  /**
   * ⚠️ Each of these names the filter it BELONGS to, rather than excluding the
   * one filter it does not. Under the old exclusion form
   * (`typeFilter === "tasks" ? [] : eligibleRuns`) adding a third tab silently
   * made every run selectable from it — pressing select-all on Goods would
   * have billed work the partner never looked at, and the command-bar total is
   * the only place they would have noticed.
   */
  const visibleSelectableRuns = useMemo(
    () => (typeFilter === "all" || typeFilter === "runs" ? eligibleRuns : []),
    [typeFilter, eligibleRuns]
  )
  const visibleSelectableTasks = useMemo(
    () => (typeFilter === "all" || typeFilter === "tasks" ? eligibleTasks : []),
    [typeFilter, eligibleTasks]
  )
  const visibleSelectableOrders = useMemo(
    () =>
      typeFilter === "all" || typeFilter === "orders" ? eligibleOrders : [],
    [typeFilter, eligibleOrders]
  )

  const allVisibleSelected =
    visibleSelectableRuns.length +
      visibleSelectableTasks.length +
      visibleSelectableOrders.length >
      0 &&
    visibleSelectableRuns.every((r: PayableRun) => selectedRunIds.has(r.run_id)) &&
    visibleSelectableTasks.every((t: PartnerAssignedTask) =>
      selectedTaskIds.has(t.id)
    ) &&
    visibleSelectableOrders.every((o: PayableInventoryOrder) =>
      selectedOrderIds.has(o.inventory_order_id)
    )

  const toggleSelectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedRunIds(new Set())
      setSelectedTaskIds(new Set())
      setSelectedOrderIds(new Set())
      return
    }
    setSelectedRunIds(
      new Set(visibleSelectableRuns.map((r: PayableRun) => r.run_id))
    )
    setSelectedTaskIds(
      new Set(visibleSelectableTasks.map((t: PartnerAssignedTask) => t.id))
    )
    setSelectedOrderIds(
      new Set(
        visibleSelectableOrders.map(
          (o: PayableInventoryOrder) => o.inventory_order_id
        )
      )
    )
  }, [
    allVisibleSelected,
    visibleSelectableRuns,
    visibleSelectableTasks,
    visibleSelectableOrders,
  ])

  // ─── Cost helpers ───────────────────────────────────────────────────
  const getEffectiveRunQuantity = useCallback(
    (run: PayableRun): number => {
      if (runQuantities[run.run_id] != null)
        return runQuantities[run.run_id]
      return run.payable_quantity
    },
    [runQuantities]
  )

  /** Whether a human has typed a rate for this run. */
  const runHasTypedRate = useCallback(
    (run: PayableRun): boolean => runUnitAmounts[run.run_id] != null,
    [runUnitAmounts]
  )

  /** Whether a live line already claimed part of this run (#1596/#1676). */
  const runAlreadyPartlyBilled = useCallback(
    (run: PayableRun): boolean => run.billing_status === "partly_billed",
    []
  )

  /**
   * The row states no price until somebody types one — an agreed TOTAL on a
   * run that has already been billed against. Re-billing the total double-pays
   * and dividing it re-prices; neither is an answer this screen may invent.
   */
  const runNeedsPrice = useCallback(
    (run: PayableRun): boolean =>
      runNeedsTypedPrice({
        unit_is_derived: run.unit_is_derived,
        hasTypedRate: runHasTypedRate(run),
        alreadyPartlyBilled: runAlreadyPartlyBilled(run),
      }),
    [runHasTypedRate, runAlreadyPartlyBilled]
  )

  /**
   * The rate in the box.
   *
   * ⚠️ Empty on a partly-billed TOTAL run: its `unit_amount` is `total /
   * ordered`, computed for display only, and showing it beside a remainder
   * invites billing the job at a price nobody re-negotiated.
   */
  const getEffectiveRunUnitAmount = useCallback(
    (run: PayableRun): number => {
      if (runUnitAmounts[run.run_id] != null)
        return runUnitAmounts[run.run_id]
      return runNeedsPrice(run) ? 0 : getRunUnitCost(run)
    },
    [runUnitAmounts, runNeedsPrice]
  )

  /**
   * 🔴 What this run bills — through the SHARED rule, not `qty × rate`.
   *
   * A total-priced run bills its agreed figure verbatim. This screen used to
   * multiply the derived rate for everything, so a ₹10,000 job that produced 7
   * of 9 was offered at ₹7,777.77 here while the admin screen offered ₹10,000
   * for the same run on the same day (#1679).
   */
  const getEffectiveRunTotal = useCallback(
    (run: PayableRun): number =>
      runLineAmount({
        quantity: getEffectiveRunQuantity(run),
        rate: getEffectiveRunUnitAmount(run),
        amount: run.amount,
        unit_is_derived: run.unit_is_derived,
        hasTypedRate: runHasTypedRate(run),
        alreadyPartlyBilled: runAlreadyPartlyBilled(run),
      }),
    [
      getEffectiveRunQuantity,
      getEffectiveRunUnitAmount,
      runHasTypedRate,
      runAlreadyPartlyBilled,
    ]
  )

  const getEffectiveTaskCost = useCallback(
    (task: PartnerAssignedTask): number => {
      if (taskCostOverrides[task.id] != null)
        return taskCostOverrides[task.id]
      return getTaskCost(task)
    },
    [taskCostOverrides]
  )

  /**
   * What this order bills.
   *
   * 🔑 `o.amount` is the SERVER's answer — the receipts value, already capped
   * at what is left against the ordered total. The screen offers it as a
   * default and lets a partner state a different figure, but it never computes
   * one: re-deriving a total is how a ₹10,000 job got re-priced to ₹12,857
   * (#1679) and how a partner was underpaid by 22% (#1596).
   */
  const getEffectiveOrderAmount = useCallback(
    (order: PayableInventoryOrder): number => {
      const typed = orderAmountOverrides[order.inventory_order_id]
      if (typed != null) return typed
      return order.amount
    },
    [orderAmountOverrides]
  )

  const handleOrderAmountChange = (orderId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setOrderAmountOverrides((prev) => {
        const next = { ...prev }
        delete next[orderId]
        return next
      })
    } else {
      setOrderAmountOverrides((prev) => ({ ...prev, [orderId]: num }))
    }
  }

  const handleRunQuantityChange = (runId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setRunQuantities((prev) => {
        const next = { ...prev }
        delete next[runId]
        return next
      })
    } else {
      setRunQuantities((prev) => ({ ...prev, [runId]: num }))
    }
  }

  const handleRunUnitAmountChange = (runId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setRunUnitAmounts((prev) => {
        const next = { ...prev }
        delete next[runId]
        return next
      })
    } else {
      setRunUnitAmounts((prev) => ({ ...prev, [runId]: num }))
    }
  }

  const handleTaskCostChange = (taskId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setTaskCostOverrides((prev) => {
        const next = { ...prev }
        delete next[taskId]
        return next
      })
    } else {
      setTaskCostOverrides((prev) => ({ ...prev, [taskId]: num }))
    }
  }

  // ─── Totals ─────────────────────────────────────────────────────────
  const totalSelected =
    selectedRunIds.size + selectedTaskIds.size + selectedOrderIds.size

  const totalAmount = useMemo(() => {
    const runTotal = eligibleRuns
      .filter((r: PayableRun) => selectedRunIds.has(r.run_id))
      .reduce((sum: number, r: PayableRun) => sum + getEffectiveRunTotal(r), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    const orderTotal = eligibleOrders
      .filter((o: PayableInventoryOrder) =>
        selectedOrderIds.has(o.inventory_order_id)
      )
      .reduce(
        (sum: number, o: PayableInventoryOrder) =>
          sum + getEffectiveOrderAmount(o),
        0
      )
    return runTotal + taskTotal + orderTotal
  }, [
    eligibleRuns,
    selectedRunIds,
    getEffectiveRunTotal,
    eligibleTasks,
    selectedTaskIds,
    getEffectiveTaskCost,
    eligibleOrders,
    selectedOrderIds,
    getEffectiveOrderAmount,
  ])

  const clearSelection = useCallback(() => {
    setSelectedRunIds(new Set())
    setSelectedTaskIds(new Set())
    setSelectedOrderIds(new Set())
  }, [])

  // ─── Rows ───────────────────────────────────────────────────────────
  const isLoading = runsLoading || tasksLoading || ordersLoading

  /**
   * One list, runs and tasks together, in the order a partner reads them.
   *
   * Blocked rows are appended rather than interleaved: they cannot be acted on,
   * so putting them among the selectable ones would make the list longer
   * without making it more useful. They only appear at all when asked for.
   */
  type Row =
    | { kind: "run"; run: PayableRun }
    | { kind: "task"; task: PartnerAssignedTask }
    | { kind: "order"; order: PayableInventoryOrder }

  /**
   * ⚠️ Each filter names the kinds it INCLUDES, rather than excluding the ones
   * it is not. The exclusion form (`typeFilter !== "tasks"`) silently drops
   * every kind added later — adding "orders" under that rule would have shown
   * runs on the Orders tab. A filter that enumerates known values and drops
   * the rest is exactly how two of four payout source types rendered nowhere
   * at all (#1621).
   */
  const visibleRows = useMemo((): Row[] => {
    const rows: Row[] = []
    if (typeFilter === "all" || typeFilter === "runs") {
      rows.push(...eligibleRuns.map((run: PayableRun) => ({ kind: "run" as const, run })))
    }
    if (typeFilter === "all" || typeFilter === "tasks") {
      rows.push(
        ...eligibleTasks.map((task: PartnerAssignedTask) => ({
          kind: "task" as const,
          task,
        }))
      )
    }
    if (typeFilter === "all" || typeFilter === "orders") {
      rows.push(
        ...eligibleOrders.map((order: PayableInventoryOrder) => ({
          kind: "order" as const,
          order,
        }))
      )
    }
    if (showSubmitted) {
      if (typeFilter === "all" || typeFilter === "runs") {
        rows.push(...blockedRuns.map((run: PayableRun) => ({ kind: "run" as const, run })))
      }
      if (typeFilter === "all" || typeFilter === "orders") {
        rows.push(
          ...blockedOrders.map((order: PayableInventoryOrder) => ({
            kind: "order" as const,
            order,
          }))
        )
      }
    }
    return rows
  }, [
    typeFilter,
    eligibleRuns,
    eligibleTasks,
    eligibleOrders,
    showSubmitted,
    blockedRuns,
    blockedOrders,
  ])

  /**
   * 🔑 An empty table must say WHICH kind of empty it is. "Nothing to bill" and
   * "nothing of the kind you filtered to" are different answers, and a partner
   * who has just filtered to Tasks and sees the generic message concludes their
   * finished runs have vanished.
   */
  const emptyMessage = useMemo(() => {
    const hiddenCount = blockedRuns.length + blockedOrders.length
    if (typeFilter === "runs") {
      return blockedRuns.length && !showSubmitted
        ? `No runs left to bill — ${blockedRuns.length} are already submitted. Tick "Show already submitted" to see them.`
        : "No payable production runs yet. Runs appear here once you complete them."
    }
    if (typeFilter === "tasks") {
      return "No payable tasks. Completed tasks that are not part of a run appear here."
    }
    if (typeFilter === "orders") {
      return blockedOrders.length && !showSubmitted
        ? `No inventory orders left to bill — ${blockedOrders.length} are already billed or have no delivery recorded. Tick "Show already submitted" to see them.`
        : "No inventory orders to bill. Orders appear here once a delivery is recorded against them."
    }
    return hiddenCount && !showSubmitted
      ? `Nothing left to bill — ${hiddenCount} item(s) are already submitted. Tick "Show already submitted" to see them.`
      : "Nothing to bill yet. Completed runs, tasks and delivered inventory orders appear here."
  }, [typeFilter, blockedRuns.length, blockedOrders.length, showSubmitted])

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (totalSelected === 0) {
      toast.error("Select at least one run, task or inventory order")
      return
    }

    // Validate runs: all must have a quantity and a unit amount
    /**
     * ⚠️ The AMOUNT, not the rate. A total-priced run legitimately bills
     * without a per-unit figure, and since #1676 the remainder of one bills
     * nothing at all until somebody states what the rest is worth — this is
     * the guard that makes them state it, rather than a zero being submitted.
     */
    const invalidRuns = eligibleRuns.filter(
      (r: PayableRun) =>
        selectedRunIds.has(r.run_id) &&
        (getEffectiveRunTotal(r) <= 0 || getEffectiveRunQuantity(r) <= 0)
    )
    const invalidTasks = eligibleTasks.filter(
      (t) => selectedTaskIds.has(t.id) && getEffectiveTaskCost(t) <= 0
    )
    /**
     * ⚠️ An order line whose amount is zero would be REFUSED by the workflow
     * ("has no recorded receipts to bill"), so catch it here where the partner
     * can see which row it was. A 400 naming an order id teaches nothing.
     */
    const invalidOrders = eligibleOrders.filter(
      (o: PayableInventoryOrder) =>
        selectedOrderIds.has(o.inventory_order_id) &&
        getEffectiveOrderAmount(o) <= 0
    )
    if (invalidRuns.length || invalidTasks.length || invalidOrders.length) {
      const names = [
        ...invalidRuns.map((r: PayableRun) => r.design_name || r.run_id),
        ...invalidTasks.map((t) => t.title || t.id),
        ...invalidOrders.map((o: PayableInventoryOrder) => o.inventory_order_id),
      ]
      toast.error(`Enter a valid amount for: ${names.join(", ")}`)
      return
    }

    try {
      /**
       * A payment line is keyed by DESIGN, not by run — one design can have
       * several completed runs, and they collapse into a single line. So the
       * payload is grouped by design and the quantities SUMMED.
       *
       * 🔴 Summing matters. Assigning `quantities[designId]` per run leaves the
       * last run's figure standing and silently discards every earlier one: a
       * partner picking runs of 3 and 5 pieces would bill 5. That is #1554's
       * shape again — units a partner made going missing between the screen and
       * the money.
       */
      const productionRunIds: Record<string, string[]> = {}
      const quantities: Record<string, number> = {}
      const unitAmounts: Record<string, number> = {}
      const costOverrides: Record<string, number> = {}
      const ratesByDesign: Record<string, Set<number>> = {}
      const exactTotals: Record<string, number> = {}
      const pricedRuns: Record<
        string,
        Array<{ quantity: number; unit_amount: number }>
      > = {}
      const rateBreakdown: Record<
        string,
        Array<{ quantity: number; unit_amount: number }>
      > = {}

      /**
       * 🔴 Which designs still bill an agreed TOTAL rather than a rate.
       *
       * This decides which request field the money is SENT on, and it is not a
       * display concern. `create` prices in a fixed order — a typed line total
       * wins outright, then a typed RATE, and only then the runs via
       * `runPayableOffer`. Sending a DERIVED rate as `unit_amounts` therefore
       * outranks the one true pricer and makes the server multiply a figure
       * that was never per-piece: ₹7,777.77 written against a ₹10,000 job
       * (#1679, and #1616 before it).
       */
      const verbatimTotalDesigns = new Set<string>()

      for (const run of eligibleRuns) {
        if (!selectedRunIds.has(run.run_id)) continue
        const designId = run.design_id
        const qty = getEffectiveRunQuantity(run)
        const rate = getEffectiveRunUnitAmount(run)

        ;(productionRunIds[designId] ||= []).push(run.run_id)
        quantities[designId] = (quantities[designId] ?? 0) + qty
        // The run's OWN amount, through the shared rule — a total-priced run
        // contributes its agreed total, not `qty × a rate derived from it`.
        exactTotals[designId] =
          (exactTotals[designId] ?? 0) + getEffectiveRunTotal(run)
        ;(ratesByDesign[designId] ||= new Set()).add(rate)
        ;(pricedRuns[designId] ||= []).push({ quantity: qty, unit_amount: rate })

        if (
          runBillsVerbatimTotal({
            unit_is_derived: run.unit_is_derived,
            hasTypedRate: runHasTypedRate(run),
            alreadyPartlyBilled: runAlreadyPartlyBilled(run),
          })
        ) {
          verbatimTotalDesigns.add(designId)
        }
      }

      for (const [designId, rates] of Object.entries(ratesByDesign)) {
        if (verbatimTotalDesigns.has(designId)) {
          // The agreed total goes on the line-total channel, which "wins
          // outright; never multiplied by quantity" — the only field that says
          // what this figure is.
          costOverrides[designId] = Math.round(exactTotals[designId] * 100) / 100
          continue
        }

        if (rates.size === 1) {
          // One agreed rate across this design's runs — state it per unit, so
          // the reviewer sees the rate and the quantity that produced the sum.
          unitAmounts[designId] = [...rates][0]
          continue
        }

        /**
         * Two runs of one design at DIFFERENT agreed rates. A line carries a
         * single `unit_amount`, so no per-unit figure is honest here — using
         * either rate, or an average, misprices the work.
         *
         * This used to send the line TOTAL and stop: the money right, and every
         * account of how it was reached discarded. The bands say it — "3 × 850
         * + 1 × 1200" — and the workflow folds them into the same total while
         * keeping `unit_amount` null, which is the truth: there isn't one.
         *
         * 🔴 Bands INSTEAD of the total, never both. Two spellings of one
         * figure must agree or the request is refused.
         */
        const bands = groupIntoRateBands(pricedRuns[designId])
        if (bands) {
          rateBreakdown[designId] = bands
        } else {
          // Every rate unusable (a zero or negative in a box). Bill the exact
          // sum rather than nothing.
          costOverrides[designId] = Math.round(exactTotals[designId] * 100) / 100
        }
      }

      /**
       * Every design named in `production_run_ids` must also appear in
       * `design_ids` — the workflow throws otherwise. Omitting it made every
       * submission from this screen a 400.
       */
      const designIds = Object.keys(productionRunIds)

      /**
       * Goods lines (#1710). One entry per order, claimed whole — the workflow
       * refuses a repeated order id, and sums per order across the submission
       * so splitting a line cannot defeat the ceiling.
       *
       * 🔑 `amount` is sent ONLY when a human typed one. Leaving it absent lets
       * the server value the order from its typed `line_fulfillments` receipts,
       * which is the one place that arithmetic lives. Echoing the server's own
       * default back at it would make this screen a second pricer.
       */
      const inventoryOrderLines = eligibleOrders
        .filter((o: PayableInventoryOrder) =>
          selectedOrderIds.has(o.inventory_order_id)
        )
        .map((o: PayableInventoryOrder) => {
          const typed = orderAmountOverrides[o.inventory_order_id]
          return typed != null
            ? { inventory_order_id: o.inventory_order_id, amount: typed }
            : { inventory_order_id: o.inventory_order_id }
        })

      await createSubmission({
        design_ids: designIds,
        task_ids: Array.from(selectedTaskIds),
        inventory_order_lines: inventoryOrderLines.length
          ? inventoryOrderLines
          : undefined,
        notes: notes || undefined,
        production_run_ids: designIds.length ? productionRunIds : undefined,
        // Per-piece prices, when this selection has any (#1596).
        rate_breakdown: Object.keys(rateBreakdown).length
          ? rateBreakdown
          : undefined,
        quantities: Object.keys(quantities).length ? quantities : undefined,
        unit_amounts: Object.keys(unitAmounts).length ? unitAmounts : undefined,
        cost_overrides: Object.keys(costOverrides).length
          ? costOverrides
          : undefined,
        task_cost_overrides: Object.keys(taskCostOverrides).length
          ? taskCostOverrides
          : undefined,
      })
      toast.success("Payment submission created successfully")
      navigate("/payment-submissions")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create submission")
    }
  }

  return (
    <RouteFocusModal prev="/payment-submissions">
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between">
          <div>
            <RouteFocusModal.Title>New Payment Submission</RouteFocusModal.Title>
            <RouteFocusModal.Description>
              Pick the work and goods you want paid for
            </RouteFocusModal.Description>
          </div>
        </div>
      </RouteFocusModal.Header>

      {/* FocusModal.Content is `overflow-hidden` and FocusModal.Body is only
          `flex-1` — the body does NOT scroll unless it asks to. Without
          `overflow-y-auto` a partner with more than a handful of eligible
          designs or tasks had the rest of the list clipped off the bottom of
          the modal with no way to reach it (the Submit button lives in the
          header, so the form still "worked" — you just couldn't see or pick
          anything past the fold). `min-h-0` lets the flex child actually shrink
          below its content height, which is what makes the scroll take effect. */}
      <RouteFocusModal.Body className="flex min-h-0 flex-1 flex-col gap-y-6 overflow-y-auto p-6 md:px-10 md:py-8">
        {/*
          Full width, not the 720px reading column this used to be.

          720px is right for a form you read top-to-bottom, which is what this
          screen was when it was a stack of cards. It is wrong for a table: five
          columns — work, qty, rate, amount, and a checkbox — inside 720px means
          the work column truncates the design name and the number inputs sit on
          top of each other, on a modal that is already occupying the whole
          screen. The container the content is in should be as wide as the thing
          the user opened.
        */}
        <div className="w-full">
          {/* Notes */}
          <div className="mb-6">
            <Text size="small" weight="plus" className="mb-2">
              Notes (optional)
            </Text>
            <Textarea
              placeholder="E.g., April batch — designs quality checked and tasks verified..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* ── Filter ────────────────────────────────────────────── */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-ui-bg-subtle p-1">
              {(
                [
                  [
                    "all",
                    "All",
                    eligibleRuns.length +
                      eligibleTasks.length +
                      eligibleOrders.length,
                  ],
                  ["runs", "Runs", eligibleRuns.length],
                  ["tasks", "Tasks", eligibleTasks.length],
                  ["orders", "Goods", eligibleOrders.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  // 🔑 A stable hook, because the accessible NAME of this
                  // button is "Runs 3" — the count badge is part of it. Any
                  // selector matching on the name is one dispatched run away
                  // from breaking, which is exactly what happened to the
                  // @partnerui payout specs on their first green CI run.
                  data-testid={`work-filter-${value}`}
                  aria-selected={typeFilter === value}
                  data-state={typeFilter === value ? "active" : "inactive"}
                  onClick={() => setTypeFilter(value)}
                  className={
                    typeFilter === value
                      ? "txt-compact-small-plus rounded-md bg-ui-bg-base px-3 py-1 shadow-elevation-card-rest"
                      : "txt-compact-small rounded-md px-3 py-1 text-ui-fg-subtle"
                  }
                >
                  {label}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {count}
                  </Badge>
                </button>
              ))}
            </div>

            {blockedRuns.length + blockedOrders.length > 0 && (
              <label className="flex items-center gap-2 text-ui-fg-subtle txt-compact-small">
                <Checkbox
                  checked={showSubmitted}
                  onCheckedChange={(v) => setShowSubmitted(!!v)}
                  aria-label="Show already submitted"
                />
                Show already submitted (
                {blockedRuns.length + blockedOrders.length})
              </label>
            )}
          </div>

          {/* ── One table of payable work ──────────────────────────── */}
          {isLoading && (
            <Container className="p-4">
              <Text size="small" className="text-ui-fg-subtle">
                Loading your payable work…
              </Text>
            </Container>
          )}

          {!isLoading && visibleRows.length === 0 && (
            <Container className="p-4">
              <Text size="small" className="text-ui-fg-subtle">
                {emptyMessage}
              </Text>
            </Container>
          )}

          {!isLoading && visibleRows.length > 0 && (
          <Container className="overflow-x-auto p-0">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell className="w-[44px]">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAllVisible}
                      aria-label="Select all shown"
                    />
                  </Table.HeaderCell>
                  <Table.HeaderCell>Work / goods</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Qty</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Rate</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleRows.map((row) =>
                  row.kind === "order" ? (
                    <InventoryOrderRow
                      key={row.order.inventory_order_id}
                      order={row.order}
                      blockedReason={orderBlockedReason(row.order)}
                      selected={selectedOrderIds.has(
                        row.order.inventory_order_id
                      )}
                      onToggle={toggleOrder}
                      amount={getEffectiveOrderAmount(row.order)}
                      onAmountChange={handleOrderAmountChange}
                    />
                  ) : row.kind === "run" ? (
                    <RunRow
                      key={row.run.run_id}
                      run={row.run}
                      blockedReason={runBlockedReason(row.run)}
                      selected={selectedRunIds.has(row.run.run_id)}
                      onToggle={toggleRun}
                      quantity={getEffectiveRunQuantity(row.run)}
                      unitAmount={getEffectiveRunUnitAmount(row.run)}
                      // 🔴 The row must not re-derive this. `qty × rate` on a
                      // total-priced run is the 22% re-pricing (#1679).
                      total={getEffectiveRunTotal(row.run)}
                      needsPrice={runNeedsPrice(row.run)}
                      onQuantityChange={handleRunQuantityChange}
                      onUnitAmountChange={handleRunUnitAmountChange}
                    />
                  ) : (
                    <TaskRow
                      key={row.task.id}
                      task={row.task}
                      selected={selectedTaskIds.has(row.task.id)}
                      onToggle={toggleTask}
                      cost={getEffectiveTaskCost(row.task)}
                      onCostChange={handleTaskCostChange}
                    />
                  )
                )}
              </Table.Body>
            </Table>
          </Container>
          )}
        </div>
      </RouteFocusModal.Body>

      {/*
        The command bar is where the selection lives now.
        Before, the running total and Submit sat in the modal HEADER while the
        list was tabbed below it — so the only place runs and tasks were ever
        added together was off-screen from whichever tab you were on, and the
        count could read zero while you had picks on the other tab. One list,
        one selection, one total, stated against the rows it came from.
      */}
      <CommandBar open={totalSelected > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            <span data-testid="submission-total">
              {totalSelected} selected · INR {totalAmount.toLocaleString()}
            </span>
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={clearSelection}
            label="Clear"
            shortcut="c"
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleSubmit}
            label="Submit for payment"
            shortcut="s"
            disabled={isCreating}
          />
        </CommandBar.Bar>
      </CommandBar>
    </RouteFocusModal>
  )
}

// ─── Rows ─────────────────────────────────────────────────────────────

const NumberCell = ({
  value,
  placeholder,
  onChange,
  label,
  disabled,
}: {
  value?: number
  placeholder: string
  onChange: (v: string) => void
  label: string
  disabled?: boolean
}) => (
  <Input
    type="number"
    size="small"
    className="w-24 text-right"
    aria-label={label}
    placeholder={placeholder}
    disabled={disabled}
    value={value != null ? String(value) : ""}
    onChange={(e) => onChange(e.target.value)}
    onClick={(e) => e.stopPropagation()}
  />
)

const RunRow = ({
  run,
  blockedReason,
  selected,
  onToggle,
  quantity,
  unitAmount,
  total,
  needsPrice,
  onQuantityChange,
  onUnitAmountChange,
}: {
  run: PayableRun
  blockedReason: string | null
  selected: boolean
  onToggle: (id: string) => void
  quantity: number
  unitAmount: number
  /** What this row BILLS — computed once, by the shared rule. */
  total: number
  /** An agreed TOTAL on a run already billed against: it has no price yet. */
  needsPrice: boolean
  onQuantityChange: (id: string, value: string) => void
  onUnitAmountChange: (id: string, value: string) => void
}) => {
  const blocked = !!blockedReason

  return (
    <Table.Row
      data-run-id={run.run_id}
      data-testid="payable-run-row"
      className={blocked ? "opacity-60" : undefined}
    >
      <Table.Cell>
        <Checkbox
          checked={selected}
          disabled={blocked}
          onCheckedChange={() => !blocked && onToggle(run.run_id)}
          aria-label={`Select ${run.design_name || run.run_id}`}
        />
      </Table.Cell>

      <Table.Cell>
        <div className="flex items-center gap-2">
          <Text weight="plus" className="truncate">
            {run.design_name || "Unnamed work"}
          </Text>
          <Badge color="blue" size="2xsmall">
            Run
          </Badge>
          {run.billing_status === "partly_billed" && !blocked && (
            <Tooltip
              content={
                run.open_ended
                  ? "Part of this run has already been paid for. It has no agreed quantity, so there is no cap on what may still be billed."
                  : `Part of this run has already been paid for. ${run.billable_remaining} of ${run.ordered_quantity} units are still billable.`
              }
            >
              <Badge color="blue" size="2xsmall">
                {/* #1676 — an open-ended run's remainder is null because there
                  * is no ceiling. Rendering it raw printed "null left to bill". */}
                {run.open_ended
                  ? "no cap on what's left"
                  : `${run.billable_remaining} left to bill`}
              </Badge>
            </Tooltip>
          )}
          {/*
            🔴 An agreed TOTAL, already billed against. The total was the price
            for the WHOLE job, so the remainder has no figure of its own —
            re-billing it double-pays and dividing it re-prices. The row bills
            nothing until somebody states what the rest is worth.
          */}
          {needsPrice && !blocked && (
            <Tooltip content="This run was agreed at a total price for the whole job, and part of it has already been paid. Type what the remaining work is worth.">
              <Badge color="red" size="2xsmall">
                Price the rest
              </Badge>
            </Tooltip>
          )}
          {run.billing_status === "unknown" && !blocked && (
            <Tooltip content="An earlier payout for this design did not record which runs it covered, so we cannot tell whether these pieces were already paid for.">
              <Badge color="orange" size="2xsmall">
                Unknown billing
              </Badge>
            </Tooltip>
          )}
          {blocked && (
            <Badge color="grey" size="2xsmall">
              {blockedReason}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <Text size="small" className="text-ui-fg-subtle">
            {/*
              ⚠️ Read "was output recorded" off `produced_quantity`, NOT off
              `quantity_basis`. Since #1676 the offer is capped at the ordered
              quantity, so an OVERPRODUCED run reports its basis as "ordered"
              while having recorded output — and `ordered_quantity` is null on a
              run with no agreed quantity at all.
            */}
            {run.produced_quantity != null
              ? `${run.produced_quantity} made of ${
                  run.ordered_quantity ?? "no agreed quantity"
                }${
                  run.ordered_quantity != null &&
                  run.produced_quantity > run.ordered_quantity
                    ? " — billing capped at ordered"
                    : " ordered"
                }`
              : run.ordered_quantity != null
                ? `${run.ordered_quantity} ordered`
                : "No agreed quantity — open-ended"}
          </Text>
          {/*
            🔴 The TAIL of the id, not the head. `prod_run_` eats 9 characters
            and a ULID's leading digits are a TIMESTAMP, so every run of one
            design renders the same "prod_run_01K…" — and that is exactly the
            case that matters, since runs of one design collapse into a single
            payment line whose quantity is their sum.
          */}
          <Text size="small" className="font-mono text-ui-fg-muted">
            <span title={run.run_id}>…{run.run_id.slice(-8)}</span>
          </Text>
        </div>
      </Table.Cell>

      <Table.Cell className="text-right">
        <NumberCell
          label={`Quantity for ${run.design_name || run.run_id}`}
          placeholder={String(run.payable_quantity)}
          value={quantity !== run.payable_quantity ? quantity : undefined}
          disabled={blocked}
          onChange={(v) => onQuantityChange(run.run_id, v)}
        />
      </Table.Cell>

      <Table.Cell className="text-right">
        {/*
          ⚠️ The placeholder is EMPTY on a row that has no price yet (#1676).
          `run.unit_amount` there is `total / ordered` — a division done for
          display on a job that was agreed as a whole, and offering it as the
          rate for the remainder re-prices work nobody re-negotiated.
        */}
        <NumberCell
          label={`Rate for ${run.design_name || run.run_id}`}
          placeholder={needsPrice ? "Type a rate" : String(run.unit_amount)}
          value={unitAmount !== run.unit_amount ? unitAmount : undefined}
          disabled={blocked}
          onChange={(v) => onUnitAmountChange(run.run_id, v)}
        />
      </Table.Cell>

      <Table.Cell className="text-right">
        <Text
          size="small"
          weight="plus"
          data-testid={`run-amount-${run.run_id}`}
        >
          {quantity.toLocaleString()} × {unitAmount.toLocaleString()} ={" "}
          {total.toLocaleString()}
        </Text>
      </Table.Cell>
    </Table.Row>
  )
}

const TaskRow = ({
  task,
  selected,
  onToggle,
  cost,
  onCostChange,
}: {
  task: PartnerAssignedTask
  selected: boolean
  onToggle: (id: string) => void
  cost: number
  onCostChange: (id: string, value: string) => void
}) => (
  <Table.Row data-task-id={task.id} data-testid="payable-task-row">
    <Table.Cell>
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(task.id)}
        aria-label={`Select ${task.title || task.id}`}
      />
    </Table.Cell>

    <Table.Cell>
      <div className="flex items-center gap-2">
        <Text weight="plus" className="truncate">
          {task.title || "Untitled task"}
        </Text>
        <Badge color="purple" size="2xsmall">
          Task
        </Badge>
      </div>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        {task.status}
      </Text>
    </Table.Cell>

    {/*
      A task is one piece of work, not a quantity × rate. Stating "1" rather
      than leaving the cell blank keeps the Amount column readable as the same
      arithmetic in every row.
    */}
    <Table.Cell className="text-right">
      <Text size="small" className="text-ui-fg-muted">
        1
      </Text>
    </Table.Cell>

    <Table.Cell className="text-right">
      <NumberCell
        label={`Cost for ${task.title || task.id}`}
        placeholder="0"
        value={cost || undefined}
        onChange={(v) => onCostChange(task.id, v)}
      />
    </Table.Cell>

    <Table.Cell className="text-right">
      <Text size="small" weight="plus" data-testid={`task-amount-${task.id}`}>
        {cost.toLocaleString()}
      </Text>
    </Table.Cell>
  </Table.Row>
)

/**
 * One inventory order this partner may bill for (#1710) — GOODS, not work.
 *
 * 🔴 The amount box is pre-filled from the server's `amount`, which is the
 * receipts value already capped at what is left against the ORDERED total. It
 * is the only figure on this row that may be sent as money. `receipts_total`
 * and `ordered_total` are shown beside it as explanation, never re-multiplied
 * into a new one — every time a screen has re-derived a payout total on this
 * codebase it has got it wrong (#1596 by 22%, #1679 by 28%).
 */
const InventoryOrderRow = ({
  order,
  blockedReason,
  selected,
  onToggle,
  amount,
  onAmountChange,
}: {
  order: PayableInventoryOrder
  blockedReason: string | null
  selected: boolean
  onToggle: (id: string) => void
  amount: number
  onAmountChange: (id: string, value: string) => void
}) => {
  const blocked = !!blockedReason

  return (
    <Table.Row
      data-inventory-order-id={order.inventory_order_id}
      data-testid="payable-inventory-order-row"
      className={blocked ? "opacity-60" : undefined}
    >
      <Table.Cell>
        <Checkbox
          checked={selected}
          disabled={blocked}
          onCheckedChange={() => onToggle(order.inventory_order_id)}
          aria-label={`Select inventory order ${order.inventory_order_id}`}
        />
      </Table.Cell>

      <Table.Cell>
        <div className="flex items-center gap-2">
          <Text weight="plus" className="truncate font-mono text-xs">
            {order.inventory_order_id}
          </Text>
          <Badge color="orange" size="2xsmall">
            Goods
          </Badge>
          {order.is_sample && (
            <Badge color="grey" size="2xsmall">
              Sample
            </Badge>
          )}
        </div>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          {order.status || "Unknown"}
          {order.lines?.length
            ? ` · ${order.lines
                .map((l) => l.material_name)
                .filter(Boolean)
                .slice(0, 2)
                .join(", ")}`
            : ""}
        </Text>
        {blockedReason && (
          <Text size="xsmall" className="mt-1 text-ui-fg-muted">
            {blockedReason}
          </Text>
        )}
        {!blocked && order.capped_by_ceiling && (
          /**
           * ⚠️ A silent cap is a reduction nobody decided. The receipts are
           * worth more than the order has headroom for, so this row offers
           * less than the goods came to — say so, with both figures.
           */
          <Tooltip
            content={`Receipts are worth ${order.receipts_total.toLocaleString()}, but only ${(order.remaining ?? 0).toLocaleString()} is left against the ordered total of ${(order.ordered_total ?? 0).toLocaleString()}.`}
          >
            <Text size="xsmall" className="mt-1 text-ui-tag-orange-text">
              capped at what is left on the order
            </Text>
          </Tooltip>
        )}
        {!blocked && order.recorded_covers_amount && (
          /**
           * 🔴 #1710 — money already paid against this order.
           *
           * Not a block: a payment on an order is not necessarily payment for
           * THIS claim, and refusing would stop a legitimate bill. But billing
           * again for goods already settled is the mistake this row can cause,
           * so it must not be silent.
           */
          <Tooltip content="Someone has already recorded a payment against this order. If that payment was for these goods, you may have been paid already — check before billing.">
            <Text size="xsmall" className="mt-1 text-ui-tag-orange-text">
              ⚠ {order.recorded_total.toLocaleString()} already paid on this
              order
            </Text>
          </Tooltip>
        )}
        {!blocked && order.claimed_total > 0 && !order.capped_by_ceiling && (
          <Text size="xsmall" className="mt-1 text-ui-fg-muted">
            {order.claimed_total.toLocaleString()} already claimed on this order
          </Text>
        )}
      </Table.Cell>

      {/* Units RECEIVED, which is what the amount is derived from — not the
          quantity ordered. The two differ on every partially-delivered order. */}
      <Table.Cell className="text-right">
        <Text size="small" className="text-ui-fg-muted">
          {order.received_quantity?.toLocaleString() ?? "—"}
        </Text>
      </Table.Cell>

      {/* No rate. An order is priced per line by material, and inventing a
          single blended rate here would be a number nobody agreed. */}
      <Table.Cell className="text-right">
        <Text size="small" className="text-ui-fg-muted">
          —
        </Text>
      </Table.Cell>

      <Table.Cell className="text-right">
        {blocked ? (
          <Text size="small" className="text-ui-fg-muted">
            —
          </Text>
        ) : (
          <NumberCell
            label={`Amount for inventory order ${order.inventory_order_id}`}
            placeholder="0"
            value={amount || undefined}
            onChange={(v) => onAmountChange(order.inventory_order_id, v)}
          />
        )}
      </Table.Cell>
    </Table.Row>
  )
}

export const Component = PaymentSubmissionCreate
