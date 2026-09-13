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
} from "@medusajs/ui"
import { Plus } from "@medusajs/icons"
import { useTranslation } from "react-i18next"
import {
  ConsumptionLog,
  usePartnerConsumptionLogs,
  useLogPartnerConsumption,
} from "../../../../hooks/api/partner-consumption-logs"
import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import { useStockLocations } from "../../../../hooks/api/stock-locations"
import { useDate } from "../../../../hooks/use-date"

interface DesignConsumptionLogsSectionProps {
  design: PartnerDesign
}

const UNIT_VALUES = ["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"]
const TYPE_VALUES = ["sample", "production", "wastage"] as const

const typeBadgeColor = (type: string) => {
  switch (type) {
    case "sample": return "blue"
    case "production": return "green"
    case "wastage": return "orange"
    default: return "grey"
  }
}

export const DesignConsumptionLogsSection = ({ design }: DesignConsumptionLogsSectionProps) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const [showForm, setShowForm] = useState(false)

  const { logs, count, isLoading } = usePartnerConsumptionLogs(design.id)
  const { mutateAsync: logConsumption, isPending: isLogging } = useLogPartnerConsumption(design.id)
  const { stock_locations = [] } = useStockLocations({ limit: 1 })

  // Auto-resolve partner's primary stock location
  const partnerLocationId = stock_locations[0]?.id || undefined
  const partnerLocationName = stock_locations[0]?.name || undefined

  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>

  // Partner status determines defaults and permissions
  const partnerStatus = design?.partner_info?.partner_status
  const canLog =
    partnerStatus === "in_progress" ||
    partnerStatus === "assigned" ||
    partnerStatus === "incoming"

  // Form state
  const [formInventoryId, setFormInventoryId] = useState("")
  const [formQuantity, setFormQuantity] = useState("")
  const [formBasis, setFormBasis] = useState("per_piece")
  const [formUnitCost, setFormUnitCost] = useState("")
  const [formUnit, setFormUnit] = useState("Meter")
  const [formType, setFormType] = useState("production")
  const [formNotes, setFormNotes] = useState("")

  const unitOptions = UNIT_VALUES.map((v) => ({
    value: v,
    label: t(`partner.designs.unitOptions.${v.toLowerCase()}`),
  }))
  const typeOptions = TYPE_VALUES.map((v) => ({
    value: v,
    label: t(`partner.designs.consumptionTypeOptions.${v}`),
  }))

  const resetForm = () => {
    setFormInventoryId("")
    setFormQuantity("")
    setFormBasis("per_piece")
    setFormUnitCost("")
    setFormUnit("Meter")
    setFormType("production")
    setFormNotes("")
    setShowForm(false)
  }

  const handleLogConsumption = async () => {
    if (!formInventoryId || !formQuantity) {
      toast.error(t("partner.designs.consumption.required"))
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
        locationId: partnerLocationId,
      })
      toast.success(t("partner.designs.consumption.logged"))
      resetForm()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("partner.designs.consumption.failed")
      )
    }
  }

  const getInventoryLabel = (itemId: string) => {
    const found = inventoryItems.find((i: any) => i.id === itemId)
    return found?.title || found?.sku || itemId
  }

  const consumptionTypeLabel = (type: string) =>
    t(`partner.designs.consumptionTypeOptions.${type}`, type)

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-x-2">
            <Heading level="h2">{t("partner.designs.consumption.heading")}</Heading>
            {count > 0 && (
              <Badge size="2xsmall" color="grey">{count}</Badge>
            )}
          </div>
          <Text className="text-ui-fg-subtle" size="small">
            {t("partner.designs.consumption.subtitle")}
            {partnerLocationName ? ` · ${partnerLocationName}` : ""}
          </Text>
        </div>
        {canLog ? (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowForm(true)}
          >
            <Plus className="mr-1.5" />
            {t("partner.designs.consumption.log")}
          </Button>
        ) : (
          partnerStatus && !canLog && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {partnerStatus === "awaiting_review" || partnerStatus === "finished"
                ? t("partner.designs.consumption.closedReview")
                : partnerStatus === "completed"
                ? t("partner.designs.consumption.closedComplete")
                : t("partner.designs.consumption.closedNone")}
            </Text>
          )
        )}
      </div>

      {/* Log Form — Medusa side drawer (replaces the old inline panel) */}
      <Drawer open={showForm} onOpenChange={(open) => (open ? setShowForm(true) : resetForm())}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>{t("partner.designs.consumption.drawerTitle")}</Drawer.Title>
            <Drawer.Description>
              {t("partner.designs.consumption.drawerDescription")}
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            {inventoryItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-y-2 py-10 text-center">
                <Text size="small" weight="plus">
                  {t("partner.designs.consumption.noInventory")}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {t("partner.designs.consumption.noInventoryHint")}
                </Text>
              </div>
            ) : (
              <>
                <div>
                  <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                    {t("partner.designs.consumption.inventoryItem")}
                  </Text>
                  <Select value={formInventoryId} onValueChange={setFormInventoryId}>
                    <Select.Trigger>
                      <Select.Value placeholder={t("partner.designs.consumption.selectItem")} />
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                      {t("partner.designs.consumption.quantity")}
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
                      means 2.15 or 4.3 depending on the answer, and it scales
                      both the costing and the stock deduction. Asked here, once.
                    */}
                    <div className="mt-1.5">
                      <Select value={formBasis} onValueChange={setFormBasis}>
                        <Select.Trigger>
                          <Select.Value placeholder={t("partner.designs.consumption.measuredAs")} />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="per_piece">
                            {t("partner.designs.consumption.perPiece")}
                          </Select.Item>
                          <Select.Item value="total">
                            {t("partner.designs.consumption.totalRun")}
                          </Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                    <Text size="xsmall" className="text-ui-fg-muted mt-1">
                      {formBasis === "per_piece"
                        ? t("partner.designs.consumption.perPieceHint")
                        : t("partner.designs.consumption.totalRunHint")}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                      {t("partner.designs.consumption.costPerUnit")}
                    </Text>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={t("partner.designs.consumption.optional")}
                      value={formUnitCost}
                      onChange={(e) => setFormUnitCost(e.target.value)}
                    />
                  </div>
                  <div>
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                      {t("partner.designs.consumption.unit")}
                    </Text>
                    <Select value={formUnit} onValueChange={setFormUnit}>
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {unitOptions.map((o) => (
                          <Select.Item key={o.value} value={o.value}>
                            {o.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                      {t("partner.designs.consumption.type")}
                    </Text>
                    <Select value={formType} onValueChange={setFormType}>
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {typeOptions.map((o) => (
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
                    {t("partner.designs.consumption.notes")}
                  </Text>
                  <Textarea
                    placeholder={t("partner.designs.consumption.notesPlaceholder")}
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
              {inventoryItems.length === 0 ? t("actions.close") : t("actions.cancel")}
            </Button>
            {inventoryItems.length > 0 && (
              <Button onClick={handleLogConsumption} isLoading={isLogging}>
                {t("partner.designs.consumption.logUsage")}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      {/* Logs List */}
      {isLoading ? (
        <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Text className="text-ui-fg-subtle">
                {t("partner.designs.consumption.empty")}
              </Text>
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
                        {(log as any).unit_cost ? ` @ ${(log as any).unit_cost}/unit` : ""}
                      </Text>
                      {log.unit_of_measure === "Piece" && (
                        <Badge size="2xsmall" color="purple">
                          {t("partner.designs.consumption.accessory")}
                        </Badge>
                      )}
                      <Badge size="2xsmall" color={typeBadgeColor(log.consumption_type)}>
                        {consumptionTypeLabel(log.consumption_type)}
                      </Badge>
                      {log.is_committed ? (
                        <Badge size="2xsmall" color="green">
                          {t("partner.designs.consumption.committed")}
                        </Badge>
                      ) : (
                        <Badge size="2xsmall" color="grey">
                          {t("partner.designs.consumption.pending")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {getInventoryLabel(log.inventory_item_id)}
                      </Text>
                      {(log as any).unit_cost && log.quantity ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          = {Math.round(log.quantity * (log as any).unit_cost * 100) / 100}
                        </Text>
                      ) : null}
                    </div>
                    {log.notes && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {log.notes}
                      </Text>
                    )}
                  </div>
                  <div className="flex flex-col items-end">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {getFullDate({ date: log.consumed_at, includeTime: true })}
                    </Text>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Total material cost summary */}
      {logs.length > 0 && logs.some((l: any) => l.unit_cost && l.quantity) && (
        <div className="flex items-center justify-between px-6 py-3 bg-ui-bg-subtle rounded-b-xl">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {t("partner.designs.consumption.totalMaterialCost")}
          </Text>
          <Text size="xsmall" weight="plus">
            {Math.round(
              logs.reduce((sum: number, l: any) =>
                sum + (Number(l.unit_cost || 0) * Number(l.quantity || 0)), 0
              ) * 100
            ) / 100}
          </Text>
        </div>
      )}
    </Container>
  )
}