import { useState } from "react"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Plus, CheckCircleSolid, ArrowPath } from "@medusajs/icons"
import {
  AdminDesign,
  ConsumptionLog,
  LinkedInventoryItem,
  useDesignConsumptionLogs,
  useDesignInventory,
  useLogConsumption,
  useCommitConsumption,
  useUpdateConsumptionLog,
  useDeleteConsumptionLog,
} from "../../hooks/api/designs"

interface DesignConsumptionLogsSectionProps {
  design: AdminDesign
}

const UNIT_OPTIONS = [
  { value: "Meter", label: "Meter" },
  { value: "Yard", label: "Yard" },
  { value: "Kilogram", label: "Kilogram" },
  { value: "Gram", label: "Gram" },
  { value: "Piece", label: "Piece" },
  { value: "Roll", label: "Roll" },
  { value: "Other", label: "Other" },
]

const TYPE_OPTIONS = [
  { value: "sample", label: "Sample" },
  { value: "production", label: "Production" },
  { value: "wastage", label: "Wastage" },
]

const typeBadgeColor = (type: string) => {
  switch (type) {
    case "sample": return "blue"
    case "production": return "green"
    case "wastage": return "orange"
    default: return "grey"
  }
}

export const DesignConsumptionLogsSection = ({ design }: DesignConsumptionLogsSectionProps) => {
  const prompt = usePrompt()
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<string>("")

  const { data: logsData, isLoading } = useDesignConsumptionLogs(
    design.id,
    filter ? { is_committed: filter === "true" ? "true" : "false" } : undefined
  )
  const { data: inventoryData } = useDesignInventory(design.id)
  const { mutateAsync: logConsumption, isPending: isLogging } = useLogConsumption(design.id)
  const { mutateAsync: commitConsumption, isPending: isCommitting } = useCommitConsumption(design.id)
  const { mutateAsync: updateLog } = useUpdateConsumptionLog(design.id)
  const { mutateAsync: deleteLog } = useDeleteConsumptionLog(design.id)

  /** The log being corrected, plus the two fields worth correcting. */
  const [editing, setEditing] = useState<ConsumptionLog | null>(null)
  const [editQuantity, setEditQuantity] = useState("")
  const [editBasis, setEditBasis] = useState<"total" | "per_piece">("total")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const beginEdit = (log: ConsumptionLog) => {
    setEditing(log)
    setEditQuantity(String(log.quantity ?? ""))
    // An unset basis opens on "total" — the reading that does NOT multiply, so
    // an operator who saves without thinking cannot silently inflate a
    // deduction by the piece count.
    setEditBasis(log.quantity_basis === "per_piece" ? "per_piece" : "total")
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    const quantity = parseFloat(editQuantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Quantity must be a positive number")
      return
    }
    setSaving(true)
    try {
      await updateLog({ logId: editing.id, quantity, quantity_basis: editBasis })
      toast.success(
        `Corrected to ${quantity} ${editing.unit_of_measure} (${editBasis === "per_piece" ? "per piece" : "total"})`
      )
      setEditing(null)
    } catch (e: any) {
      toast.error(e?.message ?? "Could not correct this log")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (log: ConsumptionLog) => {
    const ok = await prompt({
      title: "Retire this consumption log?",
      description: `${log.quantity} ${log.unit_of_measure} will no longer count towards stock deduction or design cost. An audit row records who retired it.`,
    })
    if (!ok) return
    setDeleting(log.id)
    try {
      await deleteLog(log.id)
      toast.success("Consumption log retired")
    } catch (e: any) {
      toast.error(e?.message ?? "Could not retire this log")
    } finally {
      setDeleting(null)
    }
  }

  const logs: ConsumptionLog[] = logsData?.logs || []
  const inventoryItems: LinkedInventoryItem[] = inventoryData?.inventory_items || []
  const uncommittedCount = logs.filter((l) => !l.is_committed).length

  // Form state
  const [formInventoryId, setFormInventoryId] = useState("")
  const [formQuantity, setFormQuantity] = useState("")
  const [formBasis, setFormBasis] = useState("per_piece")
  const [formUnitCost, setFormUnitCost] = useState("")
  const [formUnit, setFormUnit] = useState("Meter")
  // Smart default: use "production" for designs in production stages, "sample" for earlier stages
  const defaultType = ["Approved", "Commerce_Ready", "Completed"].includes(design.status as string)
    ? "production"
    : "sample"
  const [formType, setFormType] = useState(defaultType)
  const isDesignTerminal = ["Completed", "Cancelled", "Rejected"].includes(design.status as string)
  const [formNotes, setFormNotes] = useState("")

  const resetForm = () => {
    setFormInventoryId("")
    setFormQuantity("")
    setFormBasis("per_piece")
    setFormUnitCost("")
    setFormUnit("Meter")
    setFormType("sample")
    setFormNotes("")
    setShowForm(false)
  }

  const handleLogConsumption = async () => {
    if (!formInventoryId || !formQuantity) {
      toast.error("Inventory item and quantity are required")
      return
    }
    try {
      await logConsumption({
        inventoryItemId: formInventoryId,
        quantity: parseFloat(formQuantity),
        quantityBasis: formBasis as "total" | "per_piece",
        unitCost: formUnitCost ? parseFloat(formUnitCost) : undefined,
        unitOfMeasure: formUnit,
        consumptionType: formType as "sample" | "production" | "wastage",
        notes: formNotes || undefined,
      })
      toast.success("Consumption logged")
      resetForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to log consumption")
    }
  }

  const handleCommitAll = async () => {
    const confirmed = await prompt({
      title: "Commit all consumption logs?",
      description: `This will deduct inventory for ${uncommittedCount} uncommitted log(s). This action adjusts stock levels and cannot be undone.`,
      confirmText: "Commit All",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await commitConsumption({ commitAll: true })
      toast.success("All consumption logs committed — inventory adjusted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to commit")
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getInventoryLabel = (itemId: string) => {
    const found = inventoryItems.find(
      (i) => i.inventory_item_id === itemId || i.inventory_item?.id === itemId
    )
    return found?.inventory_item?.title || found?.inventory_item?.sku || itemId
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Material Usage</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Track raw material usage during sampling
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          {uncommittedCount > 0 && (
            <Button
              variant="secondary"
              size="small"
              onClick={handleCommitAll}
              disabled={isCommitting}
            >
              <CheckCircleSolid className="mr-1.5" />
              Commit {uncommittedCount}
            </Button>
          )}
          {isDesignTerminal ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              Design is {design.status?.toString().toLowerCase()}
            </Text>
          ) : (
            <Button
              variant="secondary"
              size="small"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-1.5" />
              Log
            </Button>
          )}
        </div>
      </div>

      {/* Log Form — Medusa side drawer (replaces the old inline panel) */}
      <Drawer open={showForm} onOpenChange={(open) => (open ? setShowForm(true) : resetForm())}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Log Material Usage</Drawer.Title>
            <Drawer.Description>
              Record raw material consumed for this design.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            {inventoryItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-y-2 py-10 text-center">
                <Text size="small" weight="plus">
                  No inventory linked yet
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  Link raw materials to this design first, then you can log
                  material usage here.
                </Text>
              </div>
            ) : (
              <>
            <div>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                Inventory Item
              </Text>
              <Select value={formInventoryId} onValueChange={setFormInventoryId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select item" />
                </Select.Trigger>
                <Select.Content>
                  {inventoryItems.map((item) => {
                    const id = item.inventory_item_id || item.inventory_item?.id || ""
                    const label = item.inventory_item?.title || item.inventory_item?.sku || id
                    return (
                      <Select.Item key={id} value={id}>
                        {label}
                      </Select.Item>
                    )
                  })}
                </Select.Content>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                  Quantity
                </Text>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                />
                {/*
                  Which one this is CANNOT be inferred later: the same 2.15 m
                  means 2.15 or 4.3 depending on the answer, and it scales both
                  the costing and the stock deduction. Asked here, once.
                */}
                <div className="flex items-center gap-2 mt-1.5">
                  <Select value={formBasis} onValueChange={setFormBasis}>
                    <Select.Trigger>
                      <Select.Value placeholder="Measured as" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="per_piece">Per piece</Select.Item>
                      <Select.Item value="total">Total for the run</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <Text size="xsmall" className="text-ui-fg-muted mt-1">
                  {formBasis === "per_piece"
                    ? "Material for ONE finished piece — multiplied by the run's output."
                    : "Material for the WHOLE run — deducted as entered."}
                </Text>
              </div>
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                  Cost per unit
                </Text>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  value={formUnitCost}
                  onChange={(e) => setFormUnitCost(e.target.value)}
                />
              </div>
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                  Unit
                </Text>
                <Select value={formUnit} onValueChange={setFormUnit}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {UNIT_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                  Type
                </Text>
                <Select value={formType} onValueChange={setFormType}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {TYPE_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
            <div>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                Notes
              </Text>
              <Textarea
                placeholder="What was this material used for?"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>
              </>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={resetForm} disabled={isLogging}>
              {inventoryItems.length === 0 ? "Close" : "Cancel"}
            </Button>
            {inventoryItems.length > 0 && (
              <Button onClick={handleLogConsumption} disabled={isLogging}>
                {isLogging ? "Logging..." : "Log Consumption"}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      {/* Filter */}
      <div className="flex items-center gap-x-2 px-6 py-2">
        <Text size="xsmall" className="text-ui-fg-subtle">Show:</Text>
        {["", "false", "true"].map((val) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
              filter === val
                ? "bg-ui-bg-interactive text-ui-fg-on-color"
                : "bg-ui-bg-subtle text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
            }`}
          >
            {val === "" ? "All" : val === "false" ? "Uncommitted" : "Committed"}
          </button>
        ))}
      </div>

      {/* Logs List */}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Text className="text-ui-fg-subtle">No consumption logs yet</Text>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Text size="small" weight="plus">
                        {log.quantity} {log.unit_of_measure}
                        {log.unit_cost ? ` @ ${log.unit_cost}/unit` : ""}
                        {log.unit_cost && log.quantity ? ` = ${Math.round(log.quantity * log.unit_cost * 100) / 100}` : ""}
                      </Text>
                      <Badge size="2xsmall" color={typeBadgeColor(log.consumption_type)}>
                        {log.consumption_type}
                      </Badge>
                      {log.is_committed ? (
                        <Badge size="2xsmall" color="green">committed</Badge>
                      ) : (
                        <Badge size="2xsmall" color="grey">pending</Badge>
                      )}
                      {/*
                        🔴 What the quantity MEASURES, which decides the number
                        by a multiple: `q` under total, `q × pieces` under
                        per-piece. It was rendered nowhere, so "2 Meter" could
                        deduct 2 or 6 and this row looked the same either way.
                        An unset basis is called out in red because it is not a
                        default — the apply job refuses to guess and skips.
                      */}
                      {log.quantity_basis === "per_piece" ? (
                        <Badge size="2xsmall" color="orange">per piece</Badge>
                      ) : log.quantity_basis === "total" ? (
                        <Badge size="2xsmall" color="blue">total</Badge>
                      ) : (
                        <Badge size="2xsmall" color="red">basis unset</Badge>
                      )}
                      {log.inventory_applied_at && (
                        <Badge size="2xsmall" color="purple">stock applied</Badge>
                      )}
                    </div>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {getInventoryLabel(log.inventory_item_id)}
                    </Text>
                    {log.notes && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {log.notes}
                      </Text>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <Badge size="2xsmall" color={log.consumed_by === "partner" ? "purple" : "blue"}>
                      {log.consumed_by}
                    </Badge>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {formatDate(log.consumed_at)}
                    </Text>
                    {/*
                      Correcting a log was impossible from anywhere — the API
                      had no edit path, so a wrong quantity or basis could only
                      be added to. Hidden once the stock movement has happened:
                      past that point the number describes a decrement that
                      occurred, and it takes a reversing entry, not an edit.
                    */}
                    {!log.inventory_applied_at && (
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(log)}
                          className="text-[11px] text-ui-fg-interactive hover:underline"
                          data-testid={`consumption-log-edit-${log.id}`}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(log)}
                          disabled={deleting === log.id}
                          className="text-[11px] text-ui-fg-error hover:underline disabled:opacity-50"
                          data-testid={`consumption-log-delete-${log.id}`}
                        >
                          {deleting === log.id ? "Retiring…" : "Retire"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/*
        Correcting a log. Quantity and basis only — everything else identifies
        the log rather than measuring it.

        🔑 The basis selector spells out what each option DOES, because the
        difference is a multiple and the words "total" and "per piece" do not
        make that obvious on their own. This is the field that would have
        deducted 12 m where 6 m was used.
      */}
      <Drawer open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Correct consumption</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4">
            {editing && (
              <>
                <Text size="small" className="text-ui-fg-subtle">
                  {getInventoryLabel(editing.inventory_item_id)} ·{" "}
                  {editing.consumption_type} · logged by {editing.consumed_by}
                </Text>

                <div className="flex flex-col gap-1">
                  <Text size="small" weight="plus">
                    Quantity ({editing.unit_of_measure})
                  </Text>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    data-testid="consumption-log-edit-quantity"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Text size="small" weight="plus">
                    What does that measure?
                  </Text>
                  <Select
                    value={editBasis}
                    onValueChange={(v) => setEditBasis(v as "total" | "per_piece")}
                  >
                    <Select.Trigger data-testid="consumption-log-edit-basis">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="total">
                        Total — deduct this much, once
                      </Select.Item>
                      <Select.Item value="per_piece">
                        Per piece — multiply by the pieces produced
                      </Select.Item>
                    </Select.Content>
                  </Select>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {editBasis === "per_piece"
                      ? "Only correct when EVERY piece uses this material. A run where one garment used one fabric and the rest another is not per-piece — record each material's own total."
                      : "Deducts exactly this amount when the stock movement is applied."}
                  </Text>
                </div>
              </>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              isLoading={saving}
              data-testid="consumption-log-edit-save"
            >
              Save correction
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}
