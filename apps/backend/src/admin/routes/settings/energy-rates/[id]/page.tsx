import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useNavigate, useParams } from "react-router-dom"
import { useState } from "react"

import { SingleColumnPage } from "../../../../components/pages/single-column-pages"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"
import {
  useEnergyRate,
  useUpdateEnergyRate,
  useDeleteEnergyRate,
} from "../../../../hooks/api/energy-rates"

const ENERGY_TYPE_LABELS: Record<string, string> = {
  energy_electricity: "Electricity",
  energy_water: "Water",
  energy_gas: "Gas",
  labor: "Labor",
}

const UOM_LABELS: Record<string, string> = {
  kWh: "kWh",
  Liter: "Liter",
  Cubic_Meter: "m\u00B3",
  Hour: "Hour",
  Other: "Other",
}

const ENERGY_TYPE_OPTIONS = [
  { label: "Electricity", value: "energy_electricity" },
  { label: "Water", value: "energy_water" },
  { label: "Gas", value: "energy_gas" },
  { label: "Labor", value: "labor" },
]

const UOM_OPTIONS = [
  { label: "kWh", value: "kWh" },
  { label: "Liter", value: "Liter" },
  { label: "Cubic Meter (m\u00B3)", value: "Cubic_Meter" },
  { label: "Hour", value: "Hour" },
  { label: "Other", value: "Other" },
]

const EnergyRateDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const prompt = usePrompt()

  const { energy_rate: rate, isPending } = useEnergyRate(id!)
  const updateRate = useUpdateEnergyRate(id!)
  const deleteRate = useDeleteEnergyRate(id!)

  const [isEditing, setIsEditing] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, any>>({})

  if (isPending || !rate) {
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />
  }

  const startEditing = () => {
    setEditValues({
      name: rate.name,
      energyType: rate.energy_type,
      unitOfMeasure: rate.unit_of_measure,
      ratePerUnit: rate.rate_per_unit,
      currency: rate.currency,
      effectiveFrom: rate.effective_from ? new Date(rate.effective_from).toISOString().split("T")[0] : "",
      effectiveTo: rate.effective_to ? new Date(rate.effective_to).toISOString().split("T")[0] : "",
      region: rate.region || "",
      isActive: rate.is_active,
      notes: rate.notes || "",
    })
    setIsEditing(true)
  }

  const handleSave = async () => {
    try {
      await updateRate.mutateAsync({
        name: editValues.name,
        energyType: editValues.energyType,
        unitOfMeasure: editValues.unitOfMeasure,
        ratePerUnit: Number(editValues.ratePerUnit),
        currency: editValues.currency,
        effectiveFrom: editValues.effectiveFrom ? new Date(editValues.effectiveFrom).toISOString() : undefined,
        effectiveTo: editValues.effectiveTo ? new Date(editValues.effectiveTo).toISOString() : null,
        region: editValues.region || null,
        isActive: editValues.isActive,
        notes: editValues.notes || null,
      })
      toast.success("Energy rate updated")
      setIsEditing(false)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update")
    }
  }

  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete Energy Rate",
      description: `Delete "${rate.name}"? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    try {
      await deleteRate.mutateAsync()
      toast.success("Energy rate deleted")
      navigate("/settings/energy-rates")
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete")
    }
  }

  const updateField = (field: string, value: any) => {
    setEditValues((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <SingleColumnPage showJSON showMetadata data={rate}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-x-2">
              <Heading level="h1">{rate.name}</Heading>
              <Badge color={rate.is_active ? "green" : "grey"}>
                {rate.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {ENERGY_TYPE_LABELS[rate.energy_type] || rate.energy_type} rate
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            {!isEditing && (
              <>
                <Button size="small" variant="secondary" onClick={startEditing}>
                  Edit
                </Button>
                <Button size="small" variant="danger" onClick={handleDelete} isLoading={deleteRate.isPending}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4">
          {isEditing ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="col-span-2">
                <Label>Name</Label>
                <Input
                  value={editValues.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              </div>

              <div>
                <Label>Type</Label>
                <Select value={editValues.energyType} onValueChange={(v) => updateField("energyType", v)}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    {ENERGY_TYPE_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label>Unit of Measure</Label>
                <Select value={editValues.unitOfMeasure} onValueChange={(v) => updateField("unitOfMeasure", v)}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    {UOM_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label>Rate per Unit</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editValues.ratePerUnit}
                  onChange={(e) => updateField("ratePerUnit", e.target.value)}
                />
              </div>

              <div>
                <Label>Currency</Label>
                <Input
                  value={editValues.currency}
                  onChange={(e) => updateField("currency", e.target.value)}
                />
              </div>

              <div>
                <Label>Effective From</Label>
                <Input
                  type="date"
                  value={editValues.effectiveFrom}
                  onChange={(e) => updateField("effectiveFrom", e.target.value)}
                />
              </div>

              <div>
                <Label>Effective To</Label>
                <Input
                  type="date"
                  value={editValues.effectiveTo}
                  onChange={(e) => updateField("effectiveTo", e.target.value)}
                />
              </div>

              <div>
                <Label>Region</Label>
                <Input
                  placeholder="e.g. Maharashtra, India"
                  value={editValues.region}
                  onChange={(e) => updateField("region", e.target.value)}
                />
              </div>

              <div className="flex items-center gap-x-3 pt-6">
                <Switch
                  checked={editValues.isActive}
                  onCheckedChange={(checked) => updateField("isActive", checked)}
                />
                <Label>Active</Label>
              </div>

              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={editValues.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                />
              </div>

              <div className="col-span-2 flex gap-x-2">
                <Button size="small" variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button size="small" onClick={handleSave} isLoading={updateRate.isPending}>
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="small" className="text-ui-fg-subtle">Type</Text>
                <Text>{ENERGY_TYPE_LABELS[rate.energy_type] || rate.energy_type}</Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Rate</Text>
                <Text>
                  {rate.rate_per_unit} {rate.currency?.toUpperCase()}/{UOM_LABELS[rate.unit_of_measure] || rate.unit_of_measure}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Effective From</Text>
                <Text>
                  {rate.effective_from
                    ? new Date(rate.effective_from).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                    : "-"}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Effective To</Text>
                <Text>
                  {rate.effective_to
                    ? new Date(rate.effective_to).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                    : "Open-ended"}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Region</Text>
                <Text>{rate.region || "All regions"}</Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Currency</Text>
                <Text>{rate.currency?.toUpperCase()}</Text>
              </div>
              {rate.notes && (
                <div className="col-span-2">
                  <Text size="small" className="text-ui-fg-subtle">Notes</Text>
                  <Text size="small">{rate.notes}</Text>
                </div>
              )}
              <div>
                <Text size="small" className="text-ui-fg-subtle">Created</Text>
                <Text size="small">
                  {new Date(rate.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Updated</Text>
                <Text size="small">
                  {new Date(rate.updated_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </Text>
              </div>
            </div>
          )}
        </div>
      </Container>
    </SingleColumnPage>
  )
}

export default EnergyRateDetailPage

export const handle = {
  breadcrumb: () => "Energy Rate Details",
}
