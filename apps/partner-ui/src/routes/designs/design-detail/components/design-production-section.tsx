import { Badge, Button, Checkbox, Container, Heading, Input, Select, Text, Textarea, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useState } from "react"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  usePartnerProductionRuns,
  useAcceptPartnerProductionRun,
  useStartPartnerProductionRun,
  useFinishPartnerProductionRun,
  useCompletePartnerProductionRun,
} from "../../../../hooks/api/partner-production-runs"
import {
  useAcceptPartnerAssignedTask,
  useFinishPartnerAssignedTask,
  useCompletePartnerAssignedTaskSubtask,
} from "../../../../hooks/api/partner-assigned-tasks"
import { getStatusBadgeColor } from "../../../../lib/status-badge"
import { extractErrorMessage } from "../../../../lib/extract-error-message"

type DesignProductionSectionProps = {
  design: PartnerDesign
}

export const DesignProductionSection = ({ design }: DesignProductionSectionProps) => {
  const { production_runs = [], isPending } = usePartnerProductionRuns({
    design_id: design.id,
    limit: 50,
  })

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Production</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (!production_runs.length) {
    return null
  }

  return (
    <>
      {production_runs.map((run: any) => (
        <ProductionRunCard key={String(run.id)} run={run} design={design} />
      ))}
    </>
  )
}

// ── Progress Steps ──────────────────────────────────────────────────

const STEPS = [
  { key: "sent_to_partner", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "started", label: "Started" },
  { key: "finished", label: "Finished" },
  { key: "completed", label: "Completed" },
]

const ProgressStepper = ({ run }: { run: any }) => {
  const status = String(run.status || "")
  if (status === "cancelled") return null

  let currentIdx = 0
  if (run.completed_at) currentIdx = 4
  else if (run.finished_at) currentIdx = 3
  else if (run.started_at) currentIdx = 2
  else if (run.accepted_at) currentIdx = 1
  else if (status === "sent_to_partner") currentIdx = 0

  return (
    <div className="flex items-center gap-1 px-6 py-3">
      {STEPS.map((step, idx) => {
        const isDone = idx <= currentIdx
        const isCurrent = idx === currentIdx
        return (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`h-1.5 w-full rounded-full ${
                  isDone ? "bg-ui-fg-interactive" : "bg-ui-border-base"
                }`}
              />
              <Text
                size="xsmall"
                className={`mt-1 ${
                  isCurrent ? "text-ui-fg-base font-medium"
                    : isDone ? "text-ui-fg-subtle"
                    : "text-ui-fg-muted"
                }`}
              >
                {step.label}
              </Text>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Production Run Card ─────────────────────────────────────────────

const ProductionRunCard = ({ run, design }: { run: any; design: PartnerDesign }) => {
  const runId = String(run.id)
  const status = String(run.status || "")
  const tasks = run.tasks || []
  const [showFinishForm, setShowFinishForm] = useState(false)
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [finishNotes, setFinishNotes] = useState("")

  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run accepted"),
  })
  const start = useStartPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run started"),
  })
  const finish = useFinishPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run finished"),
  })
  const complete = useCompletePartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run completed")
      setShowCompleteForm(false)
    },
  })

  const isCancelled = status === "cancelled"
  const isCompleted = status === "completed"
  const canAccept = !isCancelled && status === "sent_to_partner"
  const canStart = !isCancelled && status === "in_progress" && !run.started_at
  const canFinish = !isCancelled && status === "in_progress" && !!run.started_at && !run.finished_at
  const canComplete = !isCancelled && status === "in_progress" && !!run.finished_at

  const completedTasks = tasks.filter((t: any) => String(t.status) === "completed").length
  const totalTasks = tasks.length
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )

  // Handle actions with error handling
  const handleAccept = async () => {
    try { await accept.mutateAsync() }
    catch (e) { toast.error(extractErrorMessage(e)) }
  }

  const handleStart = async () => {
    try { await start.mutateAsync() }
    catch (e) { toast.error(extractErrorMessage(e)) }
  }

  const handleFinishClick = () => setShowFinishForm(true)

  const handleFinishConfirm = async () => {
    try {
      await finish.mutateAsync({ notes: finishNotes || undefined } as any)
      setShowFinishForm(false)
      setFinishNotes("")
    } catch (e) { toast.error(extractErrorMessage(e)) }
  }

  const handleCompleteClick = () => setShowCompleteForm(true)

  // Derive the primary action
  const primaryAction = canAccept
    ? { label: "Accept Run", onClick: handleAccept, loading: accept.isPending }
    : canStart
    ? { label: "Start Working", onClick: handleStart, loading: start.isPending }
    : canFinish
    ? { label: "Mark Finished", onClick: handleFinishClick, loading: finish.isPending }
    : canComplete
    ? { label: "Complete Run", onClick: handleCompleteClick, loading: complete.isPending }
    : null

  return (
    <Container className={`divide-y p-0${isCancelled ? " opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h2">Production</Heading>
            <Badge size="2xsmall" color={run.run_type === "sample" ? "blue" : "grey"}>
              {run.run_type === "sample" ? "Sample" : "Production"}
            </Badge>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Qty: {run.quantity ?? "-"}
            {run.role ? ` · ${run.role}` : ""}
            {totalTasks > 0 ? ` · ${completedTasks}/${totalTasks} tasks done` : ""}
          </Text>
          {isCancelled && (
            <Text size="xsmall" className="text-ui-fg-error mt-1">
              This production run has been cancelled by the admin.
            </Text>
          )}
          {canFinish && pendingTasks.length > 0 && (
            <Text size="xsmall" className="text-ui-fg-on-color-disabled mt-1">
              {pendingTasks.length} task(s) still pending
            </Text>
          )}
        </div>
        <div className="flex items-center gap-x-2">
          {primaryAction && (
            <Button
              size="small"
              isLoading={primaryAction.loading}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>

      {/* Progress stepper */}
      <ProgressStepper run={run} />

      {/* Finish confirmation form */}
      {showFinishForm && canFinish && (
        <div className="px-6 py-4 bg-ui-bg-subtle border-t">
          <Heading level="h3" className="mb-2">Mark as Finished</Heading>
          <Text size="small" className="text-ui-fg-subtle mb-3">
            The design will move to Technical Review for admin to inspect.
          </Text>

          {pendingTasks.length > 0 && (
            <div className="mb-3 rounded-md border p-3 bg-ui-bg-base">
              <Text size="small" weight="plus" className="text-ui-fg-on-color-disabled mb-1">
                {pendingTasks.length} task(s) still pending
              </Text>
              {pendingTasks.map((t: any) => (
                <Text key={t.id} size="xsmall" className="text-ui-fg-subtle">
                  • {t.title || t.id}
                </Text>
              ))}
            </div>
          )}

          <div className="mb-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
              Notes for reviewer (optional)
            </Text>
            <Textarea
              placeholder="Any notes about the finished work, issues encountered, etc."
              value={finishNotes}
              onChange={(e) => setFinishNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-x-2">
            <Button variant="secondary" size="small" onClick={() => { setShowFinishForm(false); setFinishNotes("") }}>
              Cancel
            </Button>
            <Button size="small" isLoading={finish.isPending} onClick={handleFinishConfirm}>
              Confirm & Mark Finished
            </Button>
          </div>
        </div>
      )}

      {/* Complete confirmation form */}
      {showCompleteForm && canComplete && (
        <CompleteRunForm
          run={run}
          design={design}
          onComplete={async (consumptions) => {
            try {
              await complete.mutateAsync(consumptions as any)
            } catch (e) {
              toast.error(extractErrorMessage(e))
            }
          }}
          onCancel={() => setShowCompleteForm(false)}
          isLoading={complete.isPending}
        />
      )}

      {/* Timeline */}
      {(run.accepted_at || run.started_at || run.finished_at || run.completed_at) && (
        <div className="px-6 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {run.accepted_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Accepted: {new Date(run.accepted_at).toLocaleDateString()}
              </Text>
            )}
            {run.started_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Started: {new Date(run.started_at).toLocaleDateString()}
              </Text>
            )}
            {run.finished_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Finished: {new Date(run.finished_at).toLocaleDateString()}
              </Text>
            )}
            {run.completed_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Completed: {new Date(run.completed_at).toLocaleDateString()}
              </Text>
            )}
          </div>
        </div>
      )}

      {/* Tasks */}
      {totalTasks > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-3">
            Tasks ({completedTasks}/{totalTasks})
          </Text>
          <div className="flex flex-col gap-y-3">
            {tasks.map((t: any) => (
              <InlineTaskCard key={String(t.id)} task={t} />
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}

// ── Complete Run Form ───────────────────────────────────────────────

const UNIT_OPTIONS = [
  { value: "Meter", label: "Meter" },
  { value: "Yard", label: "Yard" },
  { value: "Kilogram", label: "Kilogram" },
  { value: "Gram", label: "Gram" },
  { value: "Piece", label: "Piece" },
  { value: "Roll", label: "Roll" },
  { value: "Other", label: "Other" },
]

type ConsumptionEntry = {
  inventory_item_id: string
  quantity: string
  unit_cost: string
  unit_of_measure: string
  notes: string
}

const CompleteRunForm = ({
  run,
  design,
  onComplete,
  onCancel,
  isLoading,
}: {
  run: any
  design: PartnerDesign
  onComplete: (body: any) => Promise<void>
  onCancel: () => void
  isLoading: boolean
}) => {
  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>
  const tasks = run.tasks || []
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )

  // Partner's own cost estimate and notes
  const [partnerEstimate, setPartnerEstimate] = useState("")
  const [completionNotes, setCompletionNotes] = useState("")

  // Initialize one consumption entry per inventory item
  const [consumptions, setConsumptions] = useState<ConsumptionEntry[]>(
    inventoryItems.map((item) => ({
      inventory_item_id: item.id,
      quantity: "",
      unit_cost: "",
      unit_of_measure: "Meter",
      notes: "",
    }))
  )

  const updateConsumption = (idx: number, field: keyof ConsumptionEntry, value: string) => {
    setConsumptions((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    )
  }

  const handleSubmit = async () => {
    const validConsumptions = consumptions
      .filter((c) => c.quantity && parseFloat(c.quantity) > 0)
      .map((c) => ({
        inventory_item_id: c.inventory_item_id,
        quantity: parseFloat(c.quantity),
        unit_cost: c.unit_cost ? parseFloat(c.unit_cost) : undefined,
        unit_of_measure: c.unit_of_measure,
        notes: c.notes || undefined,
      }))

    const body: any = {}
    if (validConsumptions.length > 0) {
      body.consumptions = validConsumptions
    }
    if (partnerEstimate && parseFloat(partnerEstimate) > 0) {
      body.partner_cost_estimate = parseFloat(partnerEstimate)
    }
    if (completionNotes.trim()) {
      body.notes = completionNotes.trim()
    }

    await onComplete(Object.keys(body).length > 0 ? body : undefined)
  }

  return (
    <div className="px-6 py-4 bg-ui-bg-subtle border-t">
      <Heading level="h3" className="mb-2">Complete Production Run</Heading>

      {pendingTasks.length > 0 && (
        <div className="mb-4 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
          <Text size="small" weight="plus" className="text-ui-fg-on-color-disabled mb-1">
            {pendingTasks.length} pending task(s) will be marked as done
          </Text>
          <div className="flex flex-col gap-1">
            {pendingTasks.map((t: any) => (
              <Text key={t.id} size="xsmall" className="text-ui-fg-subtle">
                • {t.title || t.id} ({t.status})
              </Text>
            ))}
          </div>
        </div>
      )}

      {/* Partner's cost estimate */}
      <div className="mb-4">
        <Text size="small" weight="plus" className="mb-2">
          Your production cost estimate
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle mb-2">
          Your total cost for producing this design (labor, overheads, margin) — separate from material costs below.
        </Text>
        <div className="max-w-[200px]">
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="e.g. 1500"
            value={partnerEstimate}
            onChange={(e) => setPartnerEstimate(e.target.value)}
          />
        </div>
      </div>

      {inventoryItems.length > 0 && (
        <div className="mb-4">
          <Text size="small" weight="plus" className="mb-2">
            Record material consumption (optional)
          </Text>
          <div className="flex flex-col gap-3">
            {consumptions.map((entry, idx) => {
              const item = inventoryItems.find((i: any) => i.id === entry.inventory_item_id)
              const label = item?.title || item?.sku || entry.inventory_item_id
              return (
                <div key={entry.inventory_item_id} className="rounded-md border p-3 bg-ui-bg-base">
                  <Text size="xsmall" weight="plus" className="mb-2">{label}</Text>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Qty</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={entry.quantity}
                        onChange={(e) => updateConsumption(idx, "quantity", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Cost/unit</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Optional"
                        value={entry.unit_cost}
                        onChange={(e) => updateConsumption(idx, "unit_cost", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Unit</Text>
                      <Select value={entry.unit_of_measure} onValueChange={(v) => updateConsumption(idx, "unit_of_measure", v)}>
                        <Select.Trigger><Select.Value /></Select.Trigger>
                        <Select.Content>
                          {UNIT_OPTIONS.map((o) => (
                            <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Notes</Text>
                      <Input
                        placeholder="Optional"
                        value={entry.notes}
                        onChange={(e) => updateConsumption(idx, "notes", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {inventoryItems.length === 0 && (
            <Text size="xsmall" className="text-ui-fg-muted">
              No inventory items linked to this design.
            </Text>
          )}
        </div>
      )}

      <div className="mb-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
          Completion notes (optional)
        </Text>
        <Textarea
          placeholder="Quality observations, issues, or feedback for the admin team"
          value={completionNotes}
          onChange={(e) => setCompletionNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-x-2 mt-3">
        <Button variant="secondary" size="small" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button size="small" onClick={handleSubmit} isLoading={isLoading}>
          Confirm & Complete
        </Button>
      </div>
    </div>
  )
}

// ── Inline Task Card ────────────────────────────────────────────────

const InlineTaskCard = ({ task }: { task: any }) => {
  const taskId = String(task.id)
  const status = String(task.status || "pending")
  const canAccept = status === "pending" || status === "assigned"
  const canFinish = status === "accepted" || status === "in_progress"
  const isCompleted = status === "completed"
  const subtasks = task.subtasks || []

  const acceptTask = useAcceptPartnerAssignedTask(taskId)
  const finishTask = useFinishPartnerAssignedTask(taskId)

  const handleAccept = async () => {
    try {
      await acceptTask.mutateAsync()
      toast.success(`Task "${task.title}" accepted`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinish = async () => {
    try {
      await finishTask.mutateAsync()
      toast.success(`Task "${task.title}" finished`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-x-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus" className="truncate">
              {String(task.title || task.id)}
            </Text>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          {task.description && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-1">
              {String(task.description)}
            </Text>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-x-2">
          {canAccept && (
            <Button size="small" variant="secondary" isLoading={acceptTask.isPending} onClick={handleAccept}>
              Accept
            </Button>
          )}
          {canFinish && (
            <Button size="small" isLoading={finishTask.isPending} onClick={handleFinish}>
              Finish
            </Button>
          )}
          {isCompleted && <Checkbox checked disabled className="mt-0.5" />}
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Subtasks ({subtasks.filter((s: any) => s.status === "completed").length}/{subtasks.length})
          </Text>
          <div className="flex flex-col gap-y-2">
            {subtasks.map((sub: any) => (
              <InlineSubtaskRow key={String(sub.id)} taskId={taskId} subtask={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline Subtask Row ──────────────────────────────────────────────

const InlineSubtaskRow = ({ taskId, subtask }: { taskId: string; subtask: any }) => {
  const subtaskId = String(subtask.id)
  const isCompleted = subtask.status === "completed"
  const complete = useCompletePartnerAssignedTaskSubtask(taskId, subtaskId)

  const handleComplete = async () => {
    try {
      await complete.mutateAsync()
      toast.success(`Subtask "${subtask.title}" completed`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <div className="flex items-center justify-between gap-x-3 rounded border px-3 py-2">
      <div className="flex items-center gap-x-2 min-w-0">
        <Checkbox
          checked={isCompleted}
          disabled={isCompleted || complete.isPending}
          onCheckedChange={() => {
            if (!isCompleted) handleComplete()
          }}
        />
        <Text size="xsmall" className={isCompleted ? "line-through text-ui-fg-muted" : ""}>
          {String(subtask.title || subtask.id)}
        </Text>
      </div>
      <Badge size="2xsmall" color={getStatusBadgeColor(String(subtask.status))}>
        {String(subtask.status).replace(/_/g, " ")}
      </Badge>
    </div>
  )
}
