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
  usePayableRuns,
  type PayableRun,
} from "../../hooks/api/payment-submissions"
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
  const [activeTab, setActiveTab] = useState<"runs" | "designs" | "tasks">(
    "runs"
  )
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set())
  const [runQuantityOverrides, setRunQuantityOverrides] = useState<
    Record<string, number>
  >({})
  const [runRateOverrides, setRunRateOverrides] = useState<
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

  /** Runs already carrying an agreed rate — what "Select All" may safely take. */
  const pricedSelectableRuns = useMemo(
    () => selectableRuns.filter((r) => r.payable),
    [selectableRuns]
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
    setSelectedDesignIds(new Set())
    setSelectedTaskIds(new Set())
    setDesignCostOverrides({})
    setTaskCostOverrides({})
  }

  const handlePartnerChange = (value: string) => {
    setPartnerId(value)
    resetSelection()
  }

  // ─── Selection handlers ─────────────────────────────────────────────
  const toggleDesign = useCallback((id: string) => {
    setSelectedDesignIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleRun = useCallback((id: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /**
   * Select All takes only the PRICED runs. Bulk-selecting a run with no rate
   * would add a line the submit guard then refuses, so the button would appear
   * to work and then block the whole submission on rows the admin never chose.
   * An unpriced run is selected deliberately, one at a time, with a rate typed.
   */
  const selectAllRuns = useCallback(() => {
    setSelectedRunIds((prev) =>
      prev.size === pricedSelectableRuns.length
        ? new Set()
        : new Set(pricedSelectableRuns.map((r) => r.run_id))
    )
  }, [pricedSelectableRuns])

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

  const getRunAmount = useCallback(
    (run: PayableRun): number =>
      Math.round(getRunQuantity(run) * getRunRate(run) * 100) / 100,
    [getRunQuantity, getRunRate]
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
      { runs: PayableRun[]; quantity: number; amount: number; rates: Set<number> }
    >()

    for (const run of selectedRuns) {
      const entry = byDesign.get(run.design_id) ?? {
        runs: [],
        quantity: 0,
        amount: 0,
        rates: new Set<number>(),
      }
      entry.runs.push(run)
      entry.quantity += getRunQuantity(run)
      entry.amount = Math.round((entry.amount + getRunAmount(run)) * 100) / 100
      entry.rates.add(getRunRate(run))
      byDesign.set(run.design_id, entry)
    }

    return byDesign
  }, [selectedRuns, getRunQuantity, getRunAmount, getRunRate])

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
    selectedRuns.length + selectedDesignIds.size + selectedTaskIds.size

  const totalAmount = useMemo(() => {
    const designTotal = eligibleDesigns
      .filter((d) => selectedDesignIds.has(d.id))
      .reduce((sum, d) => sum + getEffectiveDesignCost(d), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    return designTotal + taskTotal + runsTotal
  }, [
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
      toast.error("Select at least one run, design or task")
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
                Create a submission on behalf of a partner
              </Text>
            </RouteFocusModal.Description>
          </div>
          <div className="flex items-center gap-3">
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
            <Button
              onClick={handleSubmit}
              isLoading={isCreating}
              disabled={!partnerId || totalSelected === 0}
            >
              Create Submission
            </Button>
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-6 overflow-y-auto p-6 md:p-16">
        <div className="mx-auto w-full max-w-[720px]">
          {/* Partner picker */}
          <div className="mb-6">
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

          {/* Notes */}
          <div className="mb-6">
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
                setActiveTab(v as "runs" | "designs" | "tasks")
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
                <RunsPanel
                  runs={payableRuns}
                  isLoading={runsLoading}
                  selectedIds={selectedRunIds}
                  onToggle={toggleRun}
                  onSelectAll={selectAllRuns}
                  quantityOverrides={runQuantityOverrides}
                  rateOverrides={runRateOverrides}
                  onQuantityChange={(id, value) =>
                    handleRunNumberChange(setRunQuantityOverrides, id, value)
                  }
                  onRateChange={(id, value) =>
                    handleRunNumberChange(setRunRateOverrides, id, value)
                  }
                  getQuantity={getRunQuantity}
                  getRate={getRunRate}
                  getAmount={getRunAmount}
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
      </RouteFocusModal.Body>
    </>
  )
}

// ─── Production runs panel ────────────────────────────────────────────
/**
 * One row per completed RUN — the thing that actually carries a rate and a
 * piece count. The screen this replaces listed designs and had no quantity
 * input at all, which is how a per-unit rate came to be billed once (#1554).
 *
 * Rows that cannot be billed are shown rather than filtered away: a run with no
 * agreed rate, and a run already paid for, are both things an admin looking for
 * "why isn't this here" needs to SEE. They are visibly non-selectable instead.
 */
const RunsPanel = ({
  runs,
  isLoading,
  selectedIds,
  onToggle,
  onSelectAll,
  quantityOverrides,
  rateOverrides,
  onQuantityChange,
  onRateChange,
  getQuantity,
  getRate,
  getAmount,
}: {
  runs: PayableRun[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  quantityOverrides: Record<string, number>
  rateOverrides: Record<string, number>
  onQuantityChange: (id: string, value: string) => void
  onRateChange: (id: string, value: string) => void
  getQuantity: (run: PayableRun) => number
  getRate: (run: PayableRun) => number
  getAmount: (run: PayableRun) => number
}) => {
  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          Loading production runs...
        </Text>
      </Container>
    )
  }

  if (!runs.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No completed production runs for this partner. A run has to be
          completed before it can be paid for.
        </Text>
      </Container>
    )
  }

  const selectable = runs.filter((r) => r.payable && !r.billed)

  return (
    <div className="flex flex-col gap-y-2">
      <div className="mb-1 flex items-center justify-between">
        <Heading level="h3">{selectable.length} payable</Heading>
        {selectable.length > 0 && (
          <Button variant="secondary" size="small" onClick={onSelectAll}>
            {selectedIds.size === selectable.length
              ? "Deselect All"
              : "Select All"}
          </Button>
        )}
      </div>

      {runs.map((run) => {
        // Only an existing payout blocks. A missing rate is something to TYPE,
        // not a reason the work cannot be paid for.
        const isSelectable = !run.billed
        const needsRate = !run.payable
        const suggestion =
          run.design_estimated_cost ?? run.design_production_cost ?? null
        const isSelected = selectedIds.has(run.run_id)
        const quantity = getQuantity(run)
        const rate = getRate(run)
        const amount = getAmount(run)

        // The two figures disagreeing is the normal case, not an error — it is
        // the whole reason the basis is stated instead of assumed.
        const shortfall =
          run.produced_quantity !== null &&
          run.ordered_quantity !== null &&
          run.produced_quantity !== run.ordered_quantity

        /**
         * #1596 — the shortfall beside this row is SETTLED, not pending.
         *
         * "Produced 7 of 9 ordered" is the same sentence whether the last 2
         * units are still being made or will never be made, and those are
         * opposite situations for the person deciding what to pay. The offer
         * already differs — the ceiling moved — so a screen that shows the new
         * number without the reason presents it as an unexplained reduction.
         */
        const isShortClosed = !!run.short_closed_at

        return (
          <Container
            key={run.run_id}
            className={`p-4 transition ${
              isSelected ? "ring-2 ring-ui-border-interactive" : ""
            } ${isSelectable ? "" : "opacity-60"}`}
            data-testid="payable-run-row"
            data-run-id={run.run_id}
          >
            <div className="flex items-center gap-3">
              <div
                className={isSelectable ? "cursor-pointer" : "cursor-not-allowed"}
                onClick={() => isSelectable && onToggle(run.run_id)}
              >
                <Checkbox checked={isSelected} disabled={!isSelectable} />
              </div>

              <div
                className="flex-1 min-w-0"
                onClick={() => isSelectable && onToggle(run.run_id)}
              >
                {/* flex-wrap deliberately: these badges are sentences, not
                    words, and a row that cannot wrap clips them above and
                    below the cell instead of pushing them onto a new line. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Text weight="plus" className="truncate">
                    {run.design_name || "Unnamed design"}
                  </Text>
                  {run.design_status && (
                    <Badge color="grey" size="2xsmall">
                      {run.design_status.replace(/_/g, " ")}
                    </Badge>
                  )}
                  {run.billed && (
                    <Badge color="orange" size="2xsmall">
                      Already paid — {run.billed.status}
                    </Badge>
                  )}
                  {needsRate && (
                    <Badge color="orange" size="2xsmall">
                      No agreed rate — enter one
                    </Badge>
                  )}
                  {isShortClosed && (
                    <Badge color="grey" size="2xsmall">
                      short-closed
                    </Badge>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {/* Produced vs ordered, side by side. Which one the amount is
                      built from is stated, never inferred by the reader. */}
                  <Text size="small" className="text-ui-fg-subtle">
                    Produced{" "}
                    <span className="font-semibold text-ui-fg-base">
                      {run.produced_quantity ?? "—"}
                    </span>{" "}
                    of {run.ordered_quantity ?? "—"} ordered
                  </Text>
                  {run.quantity_basis === "ordered" && (
                    <Text size="small" className="text-ui-fg-warning">
                      no output recorded — billing the ordered quantity
                    </Text>
                  )}
                  {shortfall && run.quantity_basis === "produced" && (
                    <Text size="small" className="text-ui-fg-subtle">
                      {isShortClosed
                        ? "closed short — nothing further will be made"
                        : "paying on produced"}
                    </Text>
                  )}
                  {run.rejected_quantity ? (
                    <Text size="small" className="text-ui-fg-subtle">
                      {run.rejected_quantity} rejected
                    </Text>
                  ) : null}
                  {/*
                    Long enough to be UNAMBIGUOUS. Runs are created in
                    parent/child pairs within the same millisecond, so their
                    ULIDs share a long prefix — prod's own pair differs only at
                    character 15. A shorter truncation renders two different
                    runs as the same string.
                  */}
                  <Text size="small" className="text-ui-fg-muted font-mono">
                    {run.run_id.slice(0, 24)}...
                  </Text>
                </div>

                {run.billed && (
                  <Text size="xsmall" className="text-ui-fg-muted mt-1">
                    Paid for by submission {run.billed.submission_id} (
                    {run.billed.quantity} unit
                    {run.billed.quantity === 1 ? "" : "s"})
                  </Text>
                )}
                {needsRate && suggestion != null && (
                  <Text size="xsmall" className="text-ui-fg-muted mt-1">
                    {/* A starting point, explicitly labelled as coming from the
                        design rather than from what was agreed. The box stays
                        EMPTY — billing a design cost without someone typing it
                        is the #1554 substitution. */}
                    The design estimates {suggestion.toLocaleString()} per unit.
                    That is the design's figure, not an agreed rate — check it
                    before using it.
                  </Text>
                )}
                {needsRate && suggestion == null && (
                  <Text size="xsmall" className="text-ui-fg-muted mt-1">
                    No cost recorded on the run or the design. Recalculate the
                    design's cost, or enter the agreed rate here.
                  </Text>
                )}
                {!run.billed && run.design_has_open_submission && (
                  <Text size="xsmall" className="text-ui-fg-warning mt-1">
                    This design is already in an open submission — creating
                    another will be refused until that one is resolved.
                  </Text>
                )}
              </div>

              {isSelectable && (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Qty
                    </Text>
                    <Input
                      type="number"
                      size="small"
                      className="w-20 text-right"
                      aria-label={`Quantity for ${run.design_name || run.run_id}`}
                      value={
                        quantityOverrides[run.run_id] != null
                          ? String(quantityOverrides[run.run_id])
                          : String(run.payable_quantity)
                      }
                      onChange={(e) =>
                        onQuantityChange(run.run_id, e.target.value)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Rate
                    </Text>
                    <Input
                      type="number"
                      size="small"
                      className="w-24 text-right"
                      aria-label={`Rate for ${run.design_name || run.run_id}`}
                      // Empty, not "0", when the run carries no rate — a 0 in
                      // the box reads as an agreed price of zero, and the
                      // placeholder makes it obvious a number is wanted.
                      placeholder={needsRate ? "rate" : undefined}
                      value={
                        rateOverrides[run.run_id] != null
                          ? String(rateOverrides[run.run_id])
                          : run.unit_amount > 0
                            ? String(run.unit_amount)
                            : ""
                      }
                      onChange={(e) => onRateChange(run.run_id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex flex-col items-end gap-1 w-28">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Amount
                    </Text>
                    {/* The arithmetic, shown. A partner disputing a payment
                        reads "7 × 1,200", not a bare 8,400. */}
                    <Text
                      weight="plus"
                      className="text-right"
                      data-testid={`run-amount-${run.run_id}`}
                    >
                      {rate > 0
                        ? `${quantity} × ${rate.toLocaleString()} = ${amount.toLocaleString()}`
                        : "—"}
                    </Text>
                  </div>
                </div>
              )}
            </div>
          </Container>
        )
      })}
    </div>
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
