import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Tabs,
  Text,
  Textarea,
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

const ELIGIBLE_TASK_STATUSES = ["completed"]

const getRunUnitCost = (run: PayableRun): number => run.unit_amount

const getTaskCost = (t: PartnerAssignedTask): number =>
  Number(t.actual_cost ?? t.estimated_cost ?? 0)

export const PaymentSubmissionCreate = () => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<"runs" | "tasks">("runs")
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
  const [notes, setNotes] = useState("")

  // Fetch payable runs and tasks in parallel
  const { payable_runs = [], isPending: runsLoading } = usePartnerPayableRuns()
  const { tasks = [], isPending: tasksLoading } = usePartnerAssignedTasks()

  // Filter to only clear and unknown runs (don't show already-billed)
  const eligibleRuns = useMemo(
    () =>
      payable_runs.filter(
        (r: PayableRun) => r.billing_status === "clear" || r.billing_status === "unknown"
      ),
    [payable_runs]
  )

  const eligibleTasks = useMemo(
    () =>
      tasks.filter(
        (t: PartnerAssignedTask) =>
          ELIGIBLE_TASK_STATUSES.includes(t.status || "") &&
          !t.parent_task_id // submit standalone/parent tasks only, not subtasks
      ),
    [tasks]
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

  const selectAllRuns = useCallback(() => {
    if (selectedRunIds.size === eligibleRuns.length) {
      setSelectedRunIds(new Set())
    } else {
      setSelectedRunIds(new Set(eligibleRuns.map((r: PayableRun) => r.run_id)))
    }
  }, [eligibleRuns, selectedRunIds.size])

  const selectAllTasks = useCallback(() => {
    if (selectedTaskIds.size === eligibleTasks.length) {
      setSelectedTaskIds(new Set())
    } else {
      setSelectedTaskIds(new Set(eligibleTasks.map((t) => t.id)))
    }
  }, [eligibleTasks, selectedTaskIds.size])

  // ─── Cost helpers ───────────────────────────────────────────────────
  const getEffectiveRunQuantity = useCallback(
    (run: PayableRun): number => {
      if (runQuantities[run.run_id] != null)
        return runQuantities[run.run_id]
      return run.payable_quantity
    },
    [runQuantities]
  )

  const getEffectiveRunUnitAmount = useCallback(
    (run: PayableRun): number => {
      if (runUnitAmounts[run.run_id] != null)
        return runUnitAmounts[run.run_id]
      return getRunUnitCost(run)
    },
    [runUnitAmounts]
  )

  const getEffectiveRunTotal = useCallback(
    (run: PayableRun): number => {
      return getEffectiveRunQuantity(run) * getEffectiveRunUnitAmount(run)
    },
    [getEffectiveRunQuantity, getEffectiveRunUnitAmount]
  )

  const getEffectiveTaskCost = useCallback(
    (task: PartnerAssignedTask): number => {
      if (taskCostOverrides[task.id] != null)
        return taskCostOverrides[task.id]
      return getTaskCost(task)
    },
    [taskCostOverrides]
  )

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
  const totalSelected = selectedRunIds.size + selectedTaskIds.size

  const totalAmount = useMemo(() => {
    const runTotal = eligibleRuns
      .filter((r: PayableRun) => selectedRunIds.has(r.run_id))
      .reduce((sum: number, r: PayableRun) => sum + getEffectiveRunTotal(r), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    return runTotal + taskTotal
  }, [
    eligibleRuns,
    selectedRunIds,
    getEffectiveRunTotal,
    eligibleTasks,
    selectedTaskIds,
    getEffectiveTaskCost,
  ])

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (totalSelected === 0) {
      toast.error("Select at least one run or task")
      return
    }

    // Validate runs: all must have a quantity and a unit amount
    const invalidRuns = eligibleRuns.filter(
      (r: PayableRun) =>
        selectedRunIds.has(r.run_id) &&
        (getEffectiveRunUnitAmount(r) <= 0 || getEffectiveRunQuantity(r) <= 0)
    )
    const invalidTasks = eligibleTasks.filter(
      (t) => selectedTaskIds.has(t.id) && getEffectiveTaskCost(t) <= 0
    )
    if (invalidRuns.length || invalidTasks.length) {
      const names = [
        ...invalidRuns.map((r: PayableRun) => r.design_name || r.run_id),
        ...invalidTasks.map((t) => t.title || t.id),
      ]
      toast.error(`Enter valid quantity and unit amount for: ${names.join(", ")}`)
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

      for (const run of eligibleRuns) {
        if (!selectedRunIds.has(run.run_id)) continue
        const designId = run.design_id
        const qty = getEffectiveRunQuantity(run)
        const rate = getEffectiveRunUnitAmount(run)

        ;(productionRunIds[designId] ||= []).push(run.run_id)
        quantities[designId] = (quantities[designId] ?? 0) + qty
        exactTotals[designId] = (exactTotals[designId] ?? 0) + qty * rate
        ;(ratesByDesign[designId] ||= new Set()).add(rate)
      }

      for (const [designId, rates] of Object.entries(ratesByDesign)) {
        if (rates.size === 1) {
          // One agreed rate across this design's runs — state it per unit, so
          // the reviewer sees the rate and the quantity that produced the sum.
          unitAmounts[designId] = [...rates][0]
        } else {
          /**
           * Two runs of one design at DIFFERENT agreed rates. A line carries a
           * single `unit_amount`, so no per-unit figure is honest here — using
           * either rate, or an average, misprices the work.
           *
           * `cost_overrides` is the line TOTAL and wins outright without being
           * multiplied by quantity, so the exact sum is billed while
           * `unit_amount` stays null — which is the truth: there isn't one.
           */
          costOverrides[designId] = Math.round(exactTotals[designId] * 100) / 100
        }
      }

      /**
       * Every design named in `production_run_ids` must also appear in
       * `design_ids` — the workflow throws otherwise. Omitting it made every
       * submission from this screen a 400.
       */
      const designIds = Object.keys(productionRunIds)

      await createSubmission({
        design_ids: designIds,
        task_ids: Array.from(selectedTaskIds),
        notes: notes || undefined,
        production_run_ids: designIds.length ? productionRunIds : undefined,
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
              Bundle completed designs or tasks into a payment request
            </RouteFocusModal.Description>
          </div>
          <div className="flex items-center gap-3">
            {totalSelected > 0 && (
              <Text className="text-ui-fg-subtle">
                {totalSelected} item{totalSelected !== 1 ? "s" : ""} ={" "}
                <span className="font-semibold text-ui-fg-base">
                  INR {totalAmount.toLocaleString()}
                </span>
              </Text>
            )}
            <Button
              onClick={handleSubmit}
              isLoading={isCreating}
              disabled={totalSelected === 0}
            >
              Submit for Payment
            </Button>
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
      <RouteFocusModal.Body className="flex min-h-0 flex-1 flex-col gap-y-6 overflow-y-auto p-6 md:p-16">
        <div className="mx-auto w-full max-w-[720px]">
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

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "runs" | "tasks")}
          >
            <Tabs.List>
              <Tabs.Trigger value="runs">
                Production Runs{" "}
                <Badge size="2xsmall" color="grey" className="ml-2">
                  {eligibleRuns.length}
                </Badge>
                {selectedRunIds.size > 0 && (
                  <Badge size="2xsmall" color="green" className="ml-1">
                    {selectedRunIds.size} picked
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
                eligibleRuns={eligibleRuns}
                isLoading={runsLoading}
                selectedIds={selectedRunIds}
                onToggle={toggleRun}
                onSelectAll={selectAllRuns}
                quantities={runQuantities}
                onQuantityChange={handleRunQuantityChange}
                unitAmounts={runUnitAmounts}
                onUnitAmountChange={handleRunUnitAmountChange}
                getEffectiveQuantity={getEffectiveRunQuantity}
                getEffectiveUnitAmount={getEffectiveRunUnitAmount}
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
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

// ─── Runs panel ───────────────────────────────────────────────────────
const RunsPanel = ({
  eligibleRuns,
  isLoading,
  selectedIds,
  onToggle,
  onSelectAll,
  quantities,
  onQuantityChange,
  unitAmounts,
  onUnitAmountChange,
  getEffectiveQuantity,
  getEffectiveUnitAmount,
}: {
  eligibleRuns: PayableRun[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  quantities: Record<string, number>
  onQuantityChange: (id: string, value: string) => void
  unitAmounts: Record<string, number>
  onUnitAmountChange: (id: string, value: string) => void
  getEffectiveQuantity: (run: PayableRun) => number
  getEffectiveUnitAmount: (run: PayableRun) => number
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

  if (!eligibleRuns.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No payable production runs. Production runs that have been completed
          by the partner will appear here.
        </Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-2">
      <div className="mb-1 flex items-center justify-between">
        <Heading level="h3">{eligibleRuns.length} eligible</Heading>
        <Button variant="secondary" size="small" onClick={onSelectAll}>
          {selectedIds.size === eligibleRuns.length
            ? "Deselect All"
            : "Select All"}
        </Button>
      </div>
      {eligibleRuns.map((run: PayableRun) => {
        const isSelected = selectedIds.has(run.run_id)
        const effectiveQuantity = getEffectiveQuantity(run)
        const effectiveUnitAmount = getEffectiveUnitAmount(run)

        return (
          <Container
            key={run.run_id}
            className={`p-4 transition ${
              isSelected ? "ring-2 ring-ui-border-interactive" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className="cursor-pointer"
                onClick={() => onToggle(run.run_id)}
              >
                <Checkbox checked={isSelected} />
              </div>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onToggle(run.run_id)}
              >
                <div className="flex items-center gap-2">
                  <Text weight="plus" className="truncate">
                    {run.design_name || "Unnamed design"}
                  </Text>
                  <Badge color="grey" size="2xsmall">
                    {run.quantity_basis === "produced"
                      ? `${run.produced_quantity} made`
                      : `${run.ordered_quantity} ordered`}
                  </Badge>
                  {run.billing_status === "unknown" && (
                    <Badge color="orange" size="2xsmall">
                      Unknown billing
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <Text size="small" className="text-ui-fg-subtle">
                    Completed {new Date(run.completed_at || "").toLocaleDateString()}
                  </Text>
                  <Text
                    size="small"
                    className="text-ui-fg-muted font-mono"
                  >
                    {run.run_id.slice(0, 12)}...
                  </Text>
                </div>
              </div>
              <RunCostInput
                run={run}
                quantity={quantities[run.run_id]}
                unitAmount={unitAmounts[run.run_id]}
                onQuantityChange={onQuantityChange}
                onUnitAmountChange={onUnitAmountChange}
                effectiveQuantity={effectiveQuantity}
                effectiveUnitAmount={effectiveUnitAmount}
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
  eligibleTasks: PartnerAssignedTask[]
  isLoading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  costOverrides: Record<string, number>
  onCostChange: (id: string, value: string) => void
  getEffectiveCost: (t: PartnerAssignedTask) => number
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
          No eligible tasks. Only completed tasks with a cost set can be
          submitted for payment.
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
        const defaultCost = Number(task.actual_cost ?? task.estimated_cost ?? 0)
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
                  {task.completed_at && (
                    <Text size="small" className="text-ui-fg-subtle">
                      Completed{" "}
                      {new Date(task.completed_at).toLocaleDateString()}
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

/**
 * The task cost input. Tasks are billed as a single line total, so this stays
 * the simple one-box control.
 *
 * 🔴 Restored after the runs rewrite deleted it: `RunCostInput` replaced it for
 * DESIGN lines, but `TasksPanel` still called `CostInput`. esbuild does not
 * type-check, so the bundle built cleanly and the Tasks tab threw a
 * ReferenceError the moment it rendered. tsc said so; nothing was reading tsc.
 */
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
        <Text size="xsmall" className="text-ui-fg-muted whitespace-nowrap">
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

// ─── Run cost input ───────────────────────────────────────────────────
const RunCostInput = ({
  run,
  quantity,
  unitAmount,
  onQuantityChange,
  onUnitAmountChange,
  effectiveQuantity,
  effectiveUnitAmount,
}: {
  run: PayableRun
  quantity?: number
  unitAmount?: number
  onQuantityChange: (id: string, value: string) => void
  onUnitAmountChange: (id: string, value: string) => void
  effectiveQuantity: number
  effectiveUnitAmount: number
}) => {
  const total = effectiveQuantity * effectiveUnitAmount

  return (
    <div className="flex flex-col items-end gap-2 shrink-0 w-60">
      <div className="flex gap-2 w-full">
        <div className="flex-1 flex flex-col items-end gap-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Qty
          </Text>
          <Input
            type="number"
            size="small"
            className="w-full text-right"
            placeholder={String(run.payable_quantity)}
            value={quantity != null ? String(quantity) : ""}
            onChange={(e) => onQuantityChange(run.run_id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex-1 flex flex-col items-end gap-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Rate (₹)
          </Text>
          <Input
            type="number"
            size="small"
            className="w-full text-right"
            placeholder={String(run.unit_amount)}
            value={unitAmount != null ? String(unitAmount) : ""}
            onChange={(e) => onUnitAmountChange(run.run_id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <div className="w-full text-right">
        <Text size="small" className="text-ui-fg-base font-semibold">
          Total: ₹{total.toLocaleString()}
        </Text>
      </div>
      {run.payable_quantity !== effectiveQuantity && (
        <Text size="xsmall" className="text-ui-fg-muted">
          was {run.payable_quantity} units
        </Text>
      )}
      {run.unit_amount !== effectiveUnitAmount && (
        <Text size="xsmall" className="text-ui-fg-muted">
          was ₹{run.unit_amount.toLocaleString()}/unit
        </Text>
      )}
    </div>
  )
}

export const Component = PaymentSubmissionCreate
