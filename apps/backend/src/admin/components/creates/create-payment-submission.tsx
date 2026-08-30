import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Select,
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { RouteFocusModal } from "../modal/route-focus-modal"
import { useDesigns, type AdminDesign } from "../../hooks/api/designs"
import { usePartnerTasks, type AdminPartnerTask } from "../../hooks/api/partner-tasks"
import { usePartners } from "../../hooks/api/partners-admin"
import {
  useCreatePaymentSubmission,
  usePayableInventoryOrders,
  usePayableRuns,
  type PayableInventoryOrder,
  type PayableRun,
} from "../../hooks/api/payment-submissions"
import { PayableRunsGrid } from "./payable-runs-grid"
import { PayableInventoryOrdersGrid } from "./payable-inventory-orders-grid"
import {
  runBillsVerbatimTotal as billsVerbatimTotal,
  runLineAmount,
} from "./lib/run-line-pricing"
/**
 * 🔴 From `rate-breakdown-display`, NOT `rate-breakdown`. This is a Vite
 * BROWSER bundle: the latter imports `MedusaError`, and pulling it in here
 * dragged Node built-ins into the dashboard and killed it on
 * `util.inherits is not a function` — login included — before a pixel
 * rendered (#1596). The display file imports nothing, and must keep to that.
 */
import { groupIntoRateBands } from "../../../workflows/payment_submissions/lib/rate-breakdown-display"

const ELIGIBLE_DESIGN_STATUSES = ["Commerce_Ready", "Approved"] as const
const ELIGIBLE_TASK_STATUSES = ["completed"] as const

const getDesignCost = (d: AdminDesign): number =>
  Number(d.estimated_cost || d.production_cost || 0)

const getTaskCost = (t: AdminPartnerTask): number => {
  const any = t as any
  return Number(any.actual_cost ?? any.estimated_cost ?? 0)
}

/**
 * Admin-initiated payment submission flow.
 *
 * 1. Pick a partner (searchable).
 * 2. Once picked, load that partner's payable production RUNS, plus the older
 *    design and task lists.
 * 3. Select items, adjust quantity/rate inline, add notes.
 * 4. Submit — creates a Pending submission under the partner's name via the
 *    shared createPaymentSubmissionWorkflow.
 *
 * ## Why "Runs" is the default tab
 *
 * This screen used to open on DESIGNS, and that was the bug. A design is a
 * recipe — produced many times — and it carries only a PER-UNIT cost. Billing
 * from it meant billing that per-unit figure exactly once, with no quantity
 * input anywhere on the screen: ₹850 for nine finished garments (#1554).
 *
 * A run is the payable thing. It knows the rate the partner agreed
 * (`partner_cost_estimate` + `cost_type`) and how many pieces they actually
 * made (`produced_quantity`), and it is the unit that can be marked as paid so
 * the next submission refuses to pay for it twice.
 *
 * 🔑 The quantity defaults to PRODUCED, not ordered — a partner is paid for
 * what they made. Where the two disagree the row says so out loud rather than
 * silently picking one.
 *
 * The designs and tasks tabs are kept: work that never had a run (and task
 * work, which is not production output at all) still has to be payable.
 */
export const CreatePaymentSubmissionComponent = () => {
  const navigate = useNavigate()

  const [partnerId, setPartnerId] = useState<string>("")
  /**
   * Two steps, because they are two different jobs.
   *
   * Choosing the partner decides WHOSE work is on the screen; everything after
   * it is deciding what to pay for. Sharing one page meant the picker and its
   * notes box sat above a spreadsheet forever, holding a third of the height
   * and half the width for a decision already made — and the grid, which is the
   * whole point of the screen, was squeezed into a 720px column beside them.
   */
  const [step, setStep] = useState<"partner" | "items">("partner")

  const [activeTab, setActiveTab] = useState<
    "runs" | "inventory" | "designs" | "tasks"
  >(
    "runs"
  )
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set())
  const [runQuantityOverrides, setRunQuantityOverrides] = useState<
    Record<string, number>
  >({})
  const [runRateOverrides, setRunRateOverrides] = useState<
    Record<string, number>
  >({})
  /**
   * #1612 — GOODS, as opposed to work. `create` has accepted
   * `inventory_order_lines` since the guard was written; no screen ever sent
   * one, so no payment on production carries an `inventory_order_id`.
   */
  const [selectedInventoryOrderIds, setSelectedInventoryOrderIds] = useState<
    Set<string>
  >(new Set())
  const [inventoryAmountOverrides, setInventoryAmountOverrides] = useState<
    Record<string, number>
  >({})
  const [selectedDesignIds, setSelectedDesignIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [designCostOverrides, setDesignCostOverrides] = useState<
    Record<string, number>
  >({})
  const [taskCostOverrides, setTaskCostOverrides] = useState<
    Record<string, number>
  >({})
  const [notes, setNotes] = useState("")

  // Partners — default to active partners for the picker
  const { partners = [], isPending: partnersLoading } = usePartners({
    limit: 200,
    status: "active",
  })

  // Designs — load once a partner is selected
  const { designs = [], isPending: designsLoading } = useDesigns(
    {
      partner_id: partnerId || undefined,
      limit: 200,
    },
    { enabled: !!partnerId }
  )

  // Tasks — load once a partner is selected
  const { tasks = [], isPending: tasksLoading } = usePartnerTasks(partnerId, {
    enabled: !!partnerId,
  })

  // Payable production runs — the primary source of truth for what to pay.
  const { payable_runs: payableRuns, isPending: runsLoading } =
    usePayableRuns(partnerId || undefined)

  // Goods bought FROM this partner, as opposed to work done BY them (#1612).
  const {
    payable_inventory_orders: payableInventoryOrders,
    isPending: inventoryLoading,
  } = usePayableInventoryOrders(partnerId || undefined)

  /**
   * Runs that can be billed now — everything not already paid for.
   *
   * 🔑 A missing rate does NOT disqualify a run. The rate lives on the run
   * because that is where it SHOULD be recorded, but on prod 15 of 27 completed
   * runs carry none — the partner completed the work and never entered a price.
   * That is a gap in the record, not a statement that the work was free, and an
   * admin who knows what was agreed must be able to pay it by typing the rate.
   * Blocking here would have made real completed work permanently unpayable
   * through the only screen that can pay it.
   */
  const selectableRuns = useMemo(
    () => payableRuns.filter((r) => !r.billed),
    [payableRuns]
  )

  const eligibleDesigns = useMemo(
    () =>
      designs.filter((d) =>
        ELIGIBLE_DESIGN_STATUSES.includes(
          (d.status || "") as (typeof ELIGIBLE_DESIGN_STATUSES)[number]
        )
      ),
    [designs]
  )

  const eligibleTasks = useMemo(
    () =>
      tasks.filter((t: any) =>
        ELIGIBLE_TASK_STATUSES.includes(
          (t.status || "") as (typeof ELIGIBLE_TASK_STATUSES)[number]
        ) && !t.parent_task_id
      ),
    [tasks]
  )

  const { mutateAsync: createSubmission, isPending: isCreating } =
    useCreatePaymentSubmission()

  const resetSelection = () => {
    setSelectedRunIds(new Set())
    setRunQuantityOverrides({})
    setRunRateOverrides({})
    setSelectedInventoryOrderIds(new Set())
    setInventoryAmountOverrides({})
    setSelectedDesignIds(new Set())
    setSelectedTaskIds(new Set())
    setDesignCostOverrides({})
    setTaskCostOverrides({})
  }

  const handlePartnerChange = (value: string) => {
    // A different partner means a different set of runs, so anything already
    // ticked refers to work this partner did not do.
    if (value !== partnerId) {
      resetSelection()
    }
    setPartnerId(value)
  }

  // ─── Selection handlers ─────────────────────────────────────────────
  const toggleDesign = useCallback((id: string) => {
    setSelectedDesignIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /** Units billed for a run — the produced figure unless an admin retyped it. */
  const getRunQuantity = useCallback(
    (run: PayableRun): number =>
      runQuantityOverrides[run.run_id] != null
        ? runQuantityOverrides[run.run_id]
        : run.payable_quantity,
    [runQuantityOverrides]
  )

  /** The per-unit rate — the run's agreed rate unless an admin retyped it. */
  const getRunRate = useCallback(
    (run: PayableRun): number =>
      runRateOverrides[run.run_id] != null
        ? runRateOverrides[run.run_id]
        : run.unit_amount,
    [runRateOverrides]
  )

  /**
   * Whether a human has typed a rate for this run.
   *
   * This is the line between "the system is showing you what was agreed" and
   * "you have decided a new price". Everything below turns on it.
   */
  const runHasTypedRate = useCallback(
    (run: PayableRun): boolean => runRateOverrides[run.run_id] != null,
    [runRateOverrides]
  )

  /**
   * What this run bills.
   *
   * 🔴 A `total` run's agreed figure is the price OF THE JOB, not a rate. Its
   * `unit_amount` is `total / quantity`, derived purely so a screen can show a
   * rate, and flagged `unit_is_derived` for exactly this reason: multiplying it
   * back out does not reproduce the total. On a real run — ₹10,000 agreed, 9
   * ordered, 7 made — that arithmetic bills ₹7,777.77, a 22% cut nobody
   * decided, and even when the numbers line up it loses a paisa to rounding
   * (₹9,999.99 for ₹10,000). 97 of 100 production runs are priced this way.
   *
   * So an untouched derived row bills its agreed total VERBATIM, and changing
   * the quantity does not move it — the total was never per-piece.
   *
   * Typing a rate is the deliberate way out: a human who has decided a per-unit
   * price outranks the stored figure, and from then on the row multiplies.
   */
  const getRunAmount = useCallback(
    (run: PayableRun): number =>
      runLineAmount({
        quantity: getRunQuantity(run),
        rate: getRunRate(run),
        amount: run.amount,
        unit_is_derived: run.unit_is_derived,
        hasTypedRate: runHasTypedRate(run),
      }),
    [getRunQuantity, getRunRate, runHasTypedRate]
  )

  /**
   * What an inventory order bills.
   *
   * The offered figure is the RECEIPTS value capped at what the guard will
   * still accept — see `payable-inventory-orders`. An operator may retype it;
   * `create` takes the typed amount and the guard still refuses anything past
   * the ordered total, so a typed figure cannot smuggle an overclaim through.
   */
  const getInventoryAmount = useCallback(
    (order: PayableInventoryOrder): number =>
      inventoryAmountOverrides[order.inventory_order_id] != null
        ? inventoryAmountOverrides[order.inventory_order_id]
        : order.amount,
    [inventoryAmountOverrides]
  )

  const selectedInventoryOrders = useMemo(
    () =>
      payableInventoryOrders.filter((o) =>
        selectedInventoryOrderIds.has(o.inventory_order_id)
      ),
    [payableInventoryOrders, selectedInventoryOrderIds]
  )

  const inventoryTotal = useMemo(
    () =>
      selectedInventoryOrders.reduce(
        (sum, order) => sum + getInventoryAmount(order),
        0
      ),
    [selectedInventoryOrders, getInventoryAmount]
  )

  /** A row still billing an agreed TOTAL rather than a rate it was given. */
  const runBillsVerbatimTotal = useCallback(
    (run: PayableRun): boolean =>
      billsVerbatimTotal({
        unit_is_derived: run.unit_is_derived,
        hasTypedRate: runHasTypedRate(run),
      }),
    [runHasTypedRate]
  )

  const handleRunNumberChange = (
    setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
    id: string,
    value: string
  ) => {
    const num = parseFloat(value)
    // An empty or unparseable box falls back to the run's own figure rather
    // than to zero — a half-typed number must never silently bill nothing.
    if (value === "" || isNaN(num)) {
      setter((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } else {
      setter((prev) => ({ ...prev, [id]: num }))
    }
  }

  const toggleTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const selectAllDesigns = useCallback(() => {
    if (selectedDesignIds.size === eligibleDesigns.length) {
      setSelectedDesignIds(new Set())
    } else {
      setSelectedDesignIds(new Set(eligibleDesigns.map((d) => d.id)))
    }
  }, [eligibleDesigns, selectedDesignIds.size])

  const selectAllTasks = useCallback(() => {
    if (selectedTaskIds.size === eligibleTasks.length) {
      setSelectedTaskIds(new Set())
    } else {
      setSelectedTaskIds(new Set(eligibleTasks.map((t) => t.id)))
    }
  }, [eligibleTasks, selectedTaskIds.size])

  // ─── Cost helpers ───────────────────────────────────────────────────
  const getEffectiveDesignCost = useCallback(
    (d: AdminDesign): number => {
      if (designCostOverrides[d.id] != null) return designCostOverrides[d.id]
      return getDesignCost(d)
    },
    [designCostOverrides]
  )

  const getEffectiveTaskCost = useCallback(
    (t: AdminPartnerTask): number => {
      if (taskCostOverrides[t.id] != null) return taskCostOverrides[t.id]
      return getTaskCost(t)
    },
    [taskCostOverrides]
  )

  const handleDesignCostChange = (id: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setDesignCostOverrides((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } else {
      setDesignCostOverrides((prev) => ({ ...prev, [id]: num }))
    }
  }

  const handleTaskCostChange = (id: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setTaskCostOverrides((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } else {
      setTaskCostOverrides((prev) => ({ ...prev, [id]: num }))
    }
  }

  // ─── Totals ─────────────────────────────────────────────────────────
  const selectedRuns = useMemo(
    () => selectableRuns.filter((r) => selectedRunIds.has(r.run_id)),
    [selectableRuns, selectedRunIds]
  )

  /**
   * Selected runs folded into the design-keyed shape the workflow bills in.
   *
   * A submission line is keyed by DESIGN, so two completed runs of the same
   * design collapse into one line whose quantity is their sum. Where those runs
   * were priced at the SAME rate the line keeps that rate and the breakdown
   * still reads "n × rate". Where the rates DIFFER there is no single honest
   * rate to state, so the line carries a typed total instead and records no
   * unit_amount — deriving one by dividing the total back out would invent a
   * rate nobody agreed to.
   */
  const runLinesByDesign = useMemo(() => {
    const byDesign = new Map<
      string,
      {
        runs: PayableRun[]
        quantity: number
        amount: number
        rates: Set<number>
        /**
         * Whether any run on this line is still billing an agreed TOTAL.
         *
         * 🔴 This decides which channel the line is SENT on, and it is not a
         * display concern. `create` prices in a fixed order — a typed line
         * total wins outright, then a typed RATE, and only then the runs via
         * `runPayableOffer`. Sending a derived rate as `unit_amounts` therefore
         * OUTRANKS the one true pricer and makes the server multiply a figure
         * that was never per-piece.
         */
        hasVerbatimTotal: boolean
      }
    >()

    for (const run of selectedRuns) {
      const entry = byDesign.get(run.design_id) ?? {
        runs: [],
        quantity: 0,
        amount: 0,
        rates: new Set<number>(),
        hasVerbatimTotal: false,
      }
      entry.runs.push(run)
      entry.quantity += getRunQuantity(run)
      entry.amount = Math.round((entry.amount + getRunAmount(run)) * 100) / 100
      entry.rates.add(getRunRate(run))
      entry.hasVerbatimTotal =
        entry.hasVerbatimTotal || runBillsVerbatimTotal(run)
      byDesign.set(run.design_id, entry)
    }

    return byDesign
  }, [
    selectedRuns,
    getRunQuantity,
    getRunAmount,
    getRunRate,
    runBillsVerbatimTotal,
  ])

  const runsTotal = useMemo(
    () => selectedRuns.reduce((sum, r) => sum + getRunAmount(r), 0),
    [selectedRuns, getRunAmount]
  )

  /**
   * A design cannot be billed twice in one submission — the workflow writes one
   * line per design, so a design picked in BOTH the runs tab and the designs
   * tab would silently lose one of the two amounts.
   */
  const conflictingDesignIds = useMemo(
    () =>
      [...runLinesByDesign.keys()].filter((id) => selectedDesignIds.has(id)),
    [runLinesByDesign, selectedDesignIds]
  )

  const totalSelected =
    selectedRuns.length +
    selectedInventoryOrders.length +
    selectedDesignIds.size +
    selectedTaskIds.size

  const totalAmount = useMemo(() => {
    const designTotal = eligibleDesigns
      .filter((d) => selectedDesignIds.has(d.id))
      .reduce((sum, d) => sum + getEffectiveDesignCost(d), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    return designTotal + taskTotal + runsTotal + inventoryTotal
  }, [
    inventoryTotal,
    runsTotal,
    eligibleDesigns,
    selectedDesignIds,
    getEffectiveDesignCost,
    eligibleTasks,
    selectedTaskIds,
    getEffectiveTaskCost,
  ])

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!partnerId) {
      toast.error("Pick a partner first")
      return
    }
    if (totalSelected === 0) {
      toast.error("Select at least one run, inventory order, design or task")
      return
    }

    if (conflictingDesignIds.length) {
      const names = conflictingDesignIds.map(
        (id) =>
          runLinesByDesign.get(id)?.runs[0]?.design_name ||
          eligibleDesigns.find((d) => d.id === id)?.name ||
          id
      )
      toast.error(
        `Already billed via a production run — deselect it in the Designs tab: ${names.join(", ")}`
      )
      return
    }

    const zeroRateRuns = selectedRuns.filter((r) => getRunAmount(r) <= 0)
    if (zeroRateRuns.length) {
      toast.error(
        `Enter a rate and quantity for: ${zeroRateRuns
          .map((r) => r.design_name || r.run_id)
          .join(", ")}`
      )
      return
    }

    const invalidDesigns = eligibleDesigns.filter(
      (d) => selectedDesignIds.has(d.id) && getEffectiveDesignCost(d) <= 0
    )
    const invalidTasks = eligibleTasks.filter(
      (t) => selectedTaskIds.has(t.id) && getEffectiveTaskCost(t) <= 0
    )
    if (invalidDesigns.length || invalidTasks.length) {
      const names = [
        ...invalidDesigns.map((d) => d.name || d.id),
        ...invalidTasks.map((t) => t.title || t.id),
      ]
      toast.error(`Enter a cost for: ${names.join(", ")}`)
      return
    }

    try {
      /**
       * Typed fields, not `metadata`. These decide what a partner is paid, and
       * `metadata` is validated as `z.record(z.string(), z.any())` — so a
       * mistyped key used to validate cleanly and then silently fall through to
       * the workflow's "absent means 1" default. The route now accepts
       * `cost_overrides` / `task_cost_overrides` directly and folds them onto
       * the metadata channel itself.
       */
      // Fold the selected runs into the design-keyed money contract. See
      // `runLinesByDesign` for why a mixed-rate design becomes a typed total
      // rather than an invented per-unit rate.
      const quantities: Record<string, number> = {}
      const unitAmounts: Record<string, number> = {}
      const runCostOverrides: Record<string, number> = { ...designCostOverrides }
      const productionRunIds: Record<string, string[]> = {}
      const rateBreakdown: Record<
        string,
        Array<{ quantity: number; unit_amount: number }>
      > = {}

      for (const [designId, line] of runLinesByDesign.entries()) {
        quantities[designId] = line.quantity
        productionRunIds[designId] = line.runs.map((r) => r.run_id)

        /**
         * 🔴 An agreed TOTAL goes on the line-total channel, never as a rate.
         *
         * `cost_overrides` "wins outright; never multiplied by quantity" — the
         * only channel that says what this is. Sending the derived rate in
         * `unit_amounts` instead outranks `runPayableOffer` server-side and
         * bills `quantity × total/quantity`: a 22% cut on a short run, and a
         * lost paisa even on an exact one. What the screen shows and what gets
         * written have to be the same number (#1616).
         */
        if (line.hasVerbatimTotal) {
          runCostOverrides[designId] = line.amount
          continue
        }

        if (line.rates.size === 1) {
          unitAmounts[designId] = [...line.rates][0]
          continue
        }

        /**
         * Two runs of one design at DIFFERENT agreed rates (#1596). This used
         * to send the line TOTAL and stop there — the money right, and every
         * account of how it was reached thrown away, leaving a line that says
         * ₹3,750 with a null rate and nothing to explain it.
         *
         * The bands say it: "3 × 850 + 1 × 1200". The workflow folds them into
         * the same total and keeps `unit_amount` NULL, because with two rates
         * there is no single rate to state and an average is one nobody agreed
         * to.
         *
         * 🔴 The bands are sent INSTEAD of the total, not alongside it. Two
         * spellings of one figure must agree or the request is refused, and
         * there is no reason to make the screen state it twice.
         */
        const bands = groupIntoRateBands(
          line.runs.map((r) => ({
            quantity: getRunQuantity(r),
            unit_amount: getRunRate(r),
          }))
        )

        if (bands) {
          rateBreakdown[designId] = bands
        } else {
          // Every rate dropped as unusable (a zero or a negative typed into a
          // box). Fall back to the exact total rather than billing nothing.
          runCostOverrides[designId] = line.amount
        }
      }

      const runDesignIds = [...runLinesByDesign.keys()]

      const { payment_submission } = await createSubmission({
        partner_id: partnerId,
        design_ids: [
          ...new Set([...runDesignIds, ...Array.from(selectedDesignIds)]),
        ],
        task_ids: Array.from(selectedTaskIds),
        notes: notes || undefined,
        quantities: Object.keys(quantities).length ? quantities : undefined,
        unit_amounts: Object.keys(unitAmounts).length ? unitAmounts : undefined,
        cost_overrides: Object.keys(runCostOverrides).length
          ? runCostOverrides
          : undefined,
        task_cost_overrides: Object.keys(taskCostOverrides).length
          ? taskCostOverrides
          : undefined,
        // The evidence behind the money: which finished runs this pays for, so
        // the next submission can refuse to pay for them again.
        production_run_ids: runDesignIds.length ? productionRunIds : undefined,
        // Per-piece prices, when this selection has any (#1596).
        rate_breakdown: Object.keys(rateBreakdown).length
          ? rateBreakdown
          : undefined,
        /**
         * GOODS (#1612). An order is claimed by id with an explicit amount —
         * the receipts value capped at what the guard still accepts, or a
         * figure an operator retyped. Sending no amount would default the
         * server to the raw receipts value, which on an over-delivered order
         * sits ABOVE the ordered total and is refused (#1617).
         */
        inventory_order_lines: selectedInventoryOrders.length
          ? selectedInventoryOrders.map((order) => ({
              inventory_order_id: order.inventory_order_id,
              amount: getInventoryAmount(order),
              currency: order.currency_code || undefined,
            }))
          : undefined,
        /**
         * 🔑 Paying out a COMPLETED RUN, whose proof of finished work is the
         * run itself. Completion moves a design to Technical_Review, so the
         * design-status gate would reject every run-sourced payout — and the
         * only way through used to be editing the design's status, i.e.
         * changing what the record asserts about technical review in order to
         * release a payment. Only sent when runs are actually being billed.
         */
        require_design_status: runDesignIds.length ? false : undefined,
      })
      toast.success("Payment submission created")
      navigate(`/payment-submissions/${payment_submission.id}`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to create submission")
    }
  }

  const selectedPartner = partners.find((p: any) => p.id === partnerId)

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between">
          <div>
            <RouteFocusModal.Title asChild>
              <Heading>New Payment Submission</Heading>
            </RouteFocusModal.Title>
            <RouteFocusModal.Description asChild>
              <Text size="small" className="text-ui-fg-subtle">
                {step === "partner"
                  ? "Step 1 of 2 — choose who is being paid"
                  : `Step 2 of 2 — choose what to pay ${
                      selectedPartner?.name || "them"
                    } for`}
              </Text>
            </RouteFocusModal.Description>
          </div>
          <div className="flex items-center gap-3">
            {step === "items" && (
              <>
                {totalSelected > 0 && (
                  <Text className="text-ui-fg-subtle">
                    {totalSelected} item{totalSelected !== 1 ? "s" : ""} ={" "}
                    <span
                      className="font-semibold text-ui-fg-base"
                      data-testid="submission-total"
                    >
                      INR {totalAmount.toLocaleString()}
                    </span>
                  </Text>
                )}
                {/* Back, not "change partner": switching partner from here
                    would silently discard a grid full of ticked rows, so the
                    way back is the way you came. */}
                <Button
                  variant="secondary"
                  onClick={() => setStep("partner")}
                  disabled={isCreating}
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  isLoading={isCreating}
                  disabled={!partnerId || totalSelected === 0}
                >
                  Create Submission
                </Button>
              </>
            )}
            {step === "partner" && (
              <Button
                onClick={() => setStep("items")}
                disabled={!partnerId}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </RouteFocusModal.Header>

      {/*
        Step 2 is a spreadsheet and takes the whole modal: 720px could not hold
        six columns, and Rate and Amount — the two numbers the operator is
        actually deciding between — fell off the right edge entirely. Step 1 is
        two form fields and stays in a narrow column, where a full-bleed text
        input would just be a very long line.
      */}
      <RouteFocusModal.Body
        className={
          step === "partner"
            ? "flex flex-col gap-y-6 overflow-y-auto p-6 md:p-16"
            : "flex flex-col gap-y-4 overflow-y-auto p-4 md:p-6"
        }
      >
        <div
          className={
            step === "partner" ? "mx-auto w-full max-w-[720px]" : "w-full"
          }
        >
          {/* Partner picker — step 1. */}
          <div className={step === "partner" ? "mb-6" : "hidden"}>
            <Text size="small" weight="plus" className="mb-2">
              Partner *
            </Text>
            <Select
              value={partnerId}
              onValueChange={handlePartnerChange}
              disabled={partnersLoading}
            >
              <Select.Trigger>
                <Select.Value
                  placeholder={
                    partnersLoading ? "Loading partners..." : "Select a partner"
                  }
                />
              </Select.Trigger>
              <Select.Content>
                {partners.map((p: any) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name}
                    {p.handle ? (
                      <span className="text-ui-fg-muted ml-2">@{p.handle}</span>
                    ) : null}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {selectedPartner && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                Will submit on behalf of{" "}
                <span className="font-mono">{selectedPartner.id}</span>
              </Text>
            )}
          </div>

          {/* Notes — step 1, alongside the partner. */}
          <div className={step === "partner" ? "mb-6" : "hidden"}>
            <Text size="small" weight="plus" className="mb-2">
              Notes (optional)
            </Text>
            <Textarea
              placeholder="E.g., created on behalf of partner — offline submission..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/*
            Kept MOUNTED across the step change rather than unmounted, so a rate
            half-typed into the grid survives a trip back to the partner step.
            An operator who steps back to re-read a note and loses their column
            of figures will not use the second step again.
          */}
          <div className={step === "partner" ? "hidden" : ""}>
          {!partnerId ? (
            <Container className="p-8">
              <Text className="text-ui-fg-subtle text-center">
                Pick a partner to load their payable production runs.
              </Text>
            </Container>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) =>
                setActiveTab(v as "runs" | "inventory" | "designs" | "tasks")
              }
            >
              <Tabs.List>
                <Tabs.Trigger value="runs">
                  Production runs{" "}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {selectableRuns.length}
                  </Badge>
                  {selectedRunIds.size > 0 && (
                    <Badge size="2xsmall" color="green" className="ml-1">
                      {selectedRunIds.size} picked
                    </Badge>
                  )}
                </Tabs.Trigger>
                <Tabs.Trigger value="inventory">
                  Inventory orders{" "}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {payableInventoryOrders.filter((o) => o.payable).length}
                  </Badge>
                  {selectedInventoryOrderIds.size > 0 && (
                    <Badge size="2xsmall" color="green" className="ml-1">
                      {selectedInventoryOrderIds.size} picked
                    </Badge>
                  )}
                </Tabs.Trigger>
                <Tabs.Trigger value="designs">
                  Designs{" "}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {eligibleDesigns.length}
                  </Badge>
                  {selectedDesignIds.size > 0 && (
                    <Badge size="2xsmall" color="green" className="ml-1">
                      {selectedDesignIds.size} picked
                    </Badge>
                  )}
                </Tabs.Trigger>
                <Tabs.Trigger value="tasks">
                  Tasks{" "}
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {eligibleTasks.length}
                  </Badge>
                  {selectedTaskIds.size > 0 && (
                    <Badge size="2xsmall" color="green" className="ml-1">
                      {selectedTaskIds.size} picked
                    </Badge>
                  )}
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="runs" className="mt-4">
                <PayableRunsGrid
                  runs={payableRuns}
                  isLoading={runsLoading}
                  selectedIds={selectedRunIds}
                  quantityOverrides={runQuantityOverrides}
                  rateOverrides={runRateOverrides}
                  onSelectionChange={(id, selected) =>
                    setSelectedRunIds((prev) => {
                      const next = new Set(prev)
                      if (selected) {
                        next.add(id)
                      } else {
                        next.delete(id)
                      }
                      return next
                    })
                  }
                  onQuantityChange={(id, value) =>
                    handleRunNumberChange(setRunQuantityOverrides, id, value)
                  }
                  onRateChange={(id, value) =>
                    handleRunNumberChange(setRunRateOverrides, id, value)
                  }
                  onClearSelection={() => setSelectedRunIds(new Set())}
                  getQuantity={getRunQuantity}
                  getRate={getRunRate}
                  getAmount={getRunAmount}
                  billsVerbatimTotal={runBillsVerbatimTotal}
                  hasTypedRate={runHasTypedRate}
                />
              </Tabs.Content>

              {/*
                GOODS, as opposed to work. The founder's distinction: an
                inventory order is stock coming IN, a production run is the
                work and its expenses. Both are owed to a partner and only one
                of them has ever been payable through a screen.
              */}
              <Tabs.Content value="inventory" className="mt-4">
                <PayableInventoryOrdersGrid
                  orders={payableInventoryOrders}
                  isLoading={inventoryLoading}
                  selectedIds={selectedInventoryOrderIds}
                  amountOverrides={inventoryAmountOverrides}
                  onSelectionChange={(id, selected) =>
                    setSelectedInventoryOrderIds((prev) => {
                      const next = new Set(prev)
                      if (selected) {
                        next.add(id)
                      } else {
                        next.delete(id)
                      }
                      return next
                    })
                  }
                  onAmountChange={(id, value) =>
                    handleRunNumberChange(setInventoryAmountOverrides, id, value)
                  }
                  onClearSelection={() =>
                    setSelectedInventoryOrderIds(new Set())
                  }
                  getAmount={getInventoryAmount}
                />
              </Tabs.Content>

              <Tabs.Content value="designs" className="mt-4">
                <DesignsPanel
                  eligibleDesigns={eligibleDesigns}
                  isLoading={designsLoading}
                  selectedIds={selectedDesignIds}
                  onToggle={toggleDesign}
                  onSelectAll={selectAllDesigns}
                  costOverrides={designCostOverrides}
                  onCostChange={handleDesignCostChange}
                  getEffectiveCost={getEffectiveDesignCost}
                />
              </Tabs.Content>

              <Tabs.Content value="tasks" className="mt-4">
                <TasksPanel
                  eligibleTasks={eligibleTasks}
                  isLoading={tasksLoading}
                  selectedIds={selectedTaskIds}
                  onToggle={toggleTask}
                  onSelectAll={selectAllTasks}
                  costOverrides={taskCostOverrides}
                  onCostChange={handleTaskCostChange}
                  getEffectiveCost={getEffectiveTaskCost}
                />
              </Tabs.Content>
            </Tabs>
          )}
          </div>
        </div>
      </RouteFocusModal.Body>
    </>
  )
}

// ─── Designs panel ────────────────────────────────────────────────────
const DesignsPanel = ({
  eligibleDesigns,
  isLoading,
  selectedIds,
  onToggle,
  onSelectAll,
  costOverrides,
  onCostChange,
  getEffectiveCost,
}: {
  eligibleDesigns: AdminDesign[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  costOverrides: Record<string, number>
  onCostChange: (id: string, value: string) => void
  getEffectiveCost: (d: AdminDesign) => number
}) => {
  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          Loading designs...
        </Text>
      </Container>
    )
  }

  if (!eligibleDesigns.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No eligible designs for this partner. Designs must be Approved or
          Commerce Ready.
        </Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-2">
      <div className="mb-1 flex items-center justify-between">
        <Heading level="h3">{eligibleDesigns.length} eligible</Heading>
        <Button variant="secondary" size="small" onClick={onSelectAll}>
          {selectedIds.size === eligibleDesigns.length
            ? "Deselect All"
            : "Select All"}
        </Button>
      </div>
      {eligibleDesigns.map((design) => {
        const isSelected = selectedIds.has(design.id)
        const defaultCost = getDesignCost(design)
        const effectiveCost = getEffectiveCost(design)

        return (
          <Container
            key={design.id}
            className={`p-4 transition ${
              isSelected ? "ring-2 ring-ui-border-interactive" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className="cursor-pointer"
                onClick={() => onToggle(design.id)}
              >
                <Checkbox checked={isSelected} />
              </div>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onToggle(design.id)}
              >
                <div className="flex items-center gap-2">
                  <Text weight="plus" className="truncate">
                    {design.name || "Unnamed design"}
                  </Text>
                  <Badge color="grey" size="2xsmall">
                    {design.status?.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-1">
                  {design.design_type && (
                    <Text size="small" className="text-ui-fg-subtle">
                      Type: {design.design_type}
                    </Text>
                  )}
                  <Text
                    size="small"
                    className="text-ui-fg-muted font-mono"
                  >
                    {design.id.slice(0, 12)}...
                  </Text>
                </div>
              </div>
              <CostInput
                id={design.id}
                defaultCost={defaultCost}
                override={costOverrides[design.id]}
                onChange={onCostChange}
                effectiveCost={effectiveCost}
              />
            </div>
          </Container>
        )
      })}
    </div>
  )
}

// ─── Tasks panel ──────────────────────────────────────────────────────
const TasksPanel = ({
  eligibleTasks,
  isLoading,
  selectedIds,
  onToggle,
  onSelectAll,
  costOverrides,
  onCostChange,
  getEffectiveCost,
}: {
  eligibleTasks: AdminPartnerTask[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  costOverrides: Record<string, number>
  onCostChange: (id: string, value: string) => void
  getEffectiveCost: (t: AdminPartnerTask) => number
}) => {
  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          Loading tasks...
        </Text>
      </Container>
    )
  }

  if (!eligibleTasks.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No eligible tasks for this partner. Only completed tasks with a cost
          can be submitted.
        </Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-2">
      <div className="mb-1 flex items-center justify-between">
        <Heading level="h3">{eligibleTasks.length} eligible</Heading>
        <Button variant="secondary" size="small" onClick={onSelectAll}>
          {selectedIds.size === eligibleTasks.length
            ? "Deselect All"
            : "Select All"}
        </Button>
      </div>
      {eligibleTasks.map((task) => {
        const isSelected = selectedIds.has(task.id)
        const any = task as any
        const defaultCost = Number(any.actual_cost ?? any.estimated_cost ?? 0)
        const effectiveCost = getEffectiveCost(task)

        return (
          <Container
            key={task.id}
            className={`p-4 transition ${
              isSelected ? "ring-2 ring-ui-border-interactive" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className="cursor-pointer"
                onClick={() => onToggle(task.id)}
              >
                <Checkbox checked={isSelected} />
              </div>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onToggle(task.id)}
              >
                <div className="flex items-center gap-2">
                  <Text weight="plus" className="truncate">
                    {task.title || "Untitled task"}
                  </Text>
                  <Badge color="green" size="2xsmall">
                    {task.status}
                  </Badge>
                  {task.priority && (
                    <Badge
                      color={
                        task.priority === "high"
                          ? "orange"
                          : task.priority === "medium"
                          ? "blue"
                          : "grey"
                      }
                      size="2xsmall"
                    >
                      {task.priority}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1">
                  {any.completed_at && (
                    <Text size="small" className="text-ui-fg-subtle">
                      Completed{" "}
                      {new Date(any.completed_at).toLocaleDateString()}
                    </Text>
                  )}
                  <Text
                    size="small"
                    className="text-ui-fg-muted font-mono"
                  >
                    {task.id.slice(0, 12)}...
                  </Text>
                </div>
              </div>
              <CostInput
                id={task.id}
                defaultCost={defaultCost}
                override={costOverrides[task.id]}
                onChange={onCostChange}
                effectiveCost={effectiveCost}
              />
            </div>
          </Container>
        )
      })}
    </div>
  )
}

// ─── Shared cost input ────────────────────────────────────────────────
const CostInput = ({
  id,
  defaultCost,
  override,
  onChange,
  effectiveCost,
}: {
  id: string
  defaultCost: number
  override?: number
  onChange: (id: string, value: string) => void
  effectiveCost: number
}) => {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        <Text
          size="xsmall"
          className="text-ui-fg-muted whitespace-nowrap"
        >
          INR
        </Text>
        <Input
          type="number"
          size="small"
          className="w-28 text-right"
          placeholder={defaultCost ? String(defaultCost) : "0"}
          value={
            override != null
              ? String(override)
              : defaultCost
              ? String(defaultCost)
              : ""
          }
          onChange={(e) => onChange(id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {defaultCost > 0 && effectiveCost !== defaultCost && (
        <Text size="xsmall" className="text-ui-fg-muted">
          was {defaultCost.toLocaleString()}
        </Text>
      )}
    </div>
  )
}

export default CreatePaymentSubmissionComponent
