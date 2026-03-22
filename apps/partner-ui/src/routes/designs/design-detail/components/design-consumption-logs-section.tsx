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
import { Plus } from "@medusajs/icons"
import {
  ConsumptionLog,
  usePartnerConsumptionLogs,
  useLogPartnerConsumption,
} from "../../../../hooks/api/partner-consumption-logs"
import { PartnerDesign } from "../../../../hooks/api/partner-designs"

interface DesignConsumptionLogsSectionProps {
  design: PartnerDesign
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

  const { logs, count, isLoading } = usePartnerConsumptionLogs(design.id)
  const { mutateAsync: logConsumption, isPending: isLogging } = useLogPartnerConsumption(design.id)

  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>

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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getInventoryLabel = (itemId: string) => {
    const found = inventoryItems.find((i: any) => i.id === itemId)
    return found?.title || found?.sku || itemId
  }

  const canLog = design?.partner_info?.partner_status === "in_progress"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Material Usage</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Log raw materials consumed during sampling
          </Text>
        </div>
        {canLog && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="mr-1.5" />
            Log
          </Button>
        )}
      </div>

      {/* Log Form */}
      {showForm && canLog && (
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
                  {inventoryItems.map((item: any) => (
                    <Select.Item key={item.id} value={item.id}>
                      {item.title || item.sku || item.id}
                    </Select.Item>
                  ))}
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
              {isLogging ? "Logging..." : "Log Usage"}
            </Button>
          </div>
        </div>
      )}

      {/* Logs List */}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Text className="text-ui-fg-subtle">No material usage logged yet</Text>
            </div>
          ) : (
            logs.map((log: ConsumptionLog) => (
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
                  <div className="flex flex-col items-end">
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
