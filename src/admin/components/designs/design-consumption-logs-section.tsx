import { useState } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
  Textarea,
  toast,
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
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<string>("")

  const { data: logsData, isLoading } = useDesignConsumptionLogs(
    design.id,
    filter ? { is_committed: filter } : undefined
  )
  const { data: inventoryData } = useDesignInventory(design.id)
  const { mutateAsync: logConsumption, isPending: isLogging } = useLogConsumption(design.id)
  const { mutateAsync: commitConsumption, isPending: isCommitting } = useCommitConsumption(design.id)

  const logs: ConsumptionLog[] = logsData?.logs || []
  const inventoryItems: LinkedInventoryItem[] = inventoryData?.inventory_items || []
  const uncommittedCount = logs.filter((l) => !l.is_committed).length

  // Form state
  const [formInventoryId, setFormInventoryId] = useState("")
  const [formQuantity, setFormQuantity] = useState("")
  const [formUnit, setFormUnit] = useState("Meter")
  const [formType, setFormType] = useState("sample")
  const [formNotes, setFormNotes] = useState("")

  const resetForm = () => {
    setFormInventoryId("")
    setFormQuantity("")
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
          <Heading level="h2">Consumption Logs</Heading>
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
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="mr-1.5" />
            Log
          </Button>
        </div>
      </div>

      {/* Log Form */}
      {showForm && (
        <div className="px-6 py-4 bg-ui-bg-subtle">
          <div className="grid grid-cols-2 gap-3">
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
            <div className="col-span-2">
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
          </div>
          <div className="flex justify-end gap-x-2 mt-3">
            <Button variant="secondary" size="small" onClick={resetForm}>
              Cancel
            </Button>
            <Button size="small" onClick={handleLogConsumption} disabled={isLogging}>
              {isLogging ? "Logging..." : "Log Consumption"}
            </Button>
          </div>
        </div>
      )}

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
                      </Text>
                      <Badge size="2xsmall" color={typeBadgeColor(log.consumption_type)}>
                        {log.consumption_type}
                      </Badge>
                      {log.is_committed ? (
                        <Badge size="2xsmall" color="green">committed</Badge>
                      ) : (
                        <Badge size="2xsmall" color="grey">pending</Badge>
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
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </Container>
  )
}
