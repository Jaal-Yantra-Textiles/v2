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
import { useCreatePaymentSubmission } from "../../hooks/api/payment-submissions"

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
 * 2. Once picked, load that partner's eligible designs + tasks.
 * 3. Select items across the two tabs, override costs inline, add notes.
 * 4. Submit — creates a Pending submission under the partner's name via the
 *    shared createPaymentSubmissionWorkflow.
 */
export const CreatePaymentSubmissionComponent = () => {
  const navigate = useNavigate()

  const [partnerId, setPartnerId] = useState<string>("")
  const [activeTab, setActiveTab] = useState<"designs" | "tasks">("designs")
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
  const totalSelected = selectedDesignIds.size + selectedTaskIds.size

  const totalAmount = useMemo(() => {
    const designTotal = eligibleDesigns
      .filter((d) => selectedDesignIds.has(d.id))
      .reduce((sum, d) => sum + getEffectiveDesignCost(d), 0)
    const taskTotal = eligibleTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .reduce((sum, t) => sum + getEffectiveTaskCost(t), 0)
    return designTotal + taskTotal
  }, [
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
      toast.error("Select at least one design or task")
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
      const metadata: Record<string, any> = {}
      if (Object.keys(designCostOverrides).length) {
        metadata.design_cost_overrides = designCostOverrides
      }
      if (Object.keys(taskCostOverrides).length) {
        metadata.task_cost_overrides = taskCostOverrides
      }

      const { payment_submission } = await createSubmission({
        partner_id: partnerId,
        design_ids: Array.from(selectedDesignIds),
        task_ids: Array.from(selectedTaskIds),
        notes: notes || undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
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
                <span className="font-semibold text-ui-fg-base">
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
                Pick a partner to load their eligible designs and tasks.
              </Text>
            </Container>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "designs" | "tasks")}
            >
              <Tabs.List>
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
