import { Fragment, useMemo, useState } from "react"
import { Button, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"

import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import {
  RawMaterialGroup,
  useUpdateRawMaterialGroup,
} from "../../hooks/api/raw-material-groups"
import { useRawMaterialCategories } from "../../hooks/api/raw-materials"
import { useStockLocations } from "../../hooks/api/stock_location"
import { Combobox } from "../inputs/combobox/combobox"

const UNIT_OPTIONS = ["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"]
const STATUS_OPTIONS = ["Active", "Discontinued", "Under_Review", "Development"]

/**
 * Edit a Material Group's "global" specs (#829) in a route drawer. These are set
 * once and inherited fill-blank by new colors; use the Data Plumbing job to push
 * edits onto colors that already exist.
 */
export const EditGroupForm = ({ group }: { group: RawMaterialGroup }) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateRawMaterialGroup(group.id)
  const { stock_locations = [] } = useStockLocations()
  const { categories: materialCategories = [] } = useRawMaterialCategories({
    limit: 200,
  })

  const [name, setName] = useState(group.name || "")
  const [status, setStatus] = useState(group.status || "Active")
  const [composition, setComposition] = useState(group.composition || "")
  const [unit, setUnit] = useState(group.unit_of_measure || "Other")
  const [materialType, setMaterialType] = useState(group.material_type?.name || "")
  const [locationId, setLocationId] = useState(group.stock_location_id || "")
  const [unitCost, setUnitCost] = useState(
    group.unit_cost != null ? String(group.unit_cost) : ""
  )
  const [currency, setCurrency] = useState(group.cost_currency || "")
  const [leadTime, setLeadTime] = useState(
    group.lead_time_days != null ? String(group.lead_time_days) : ""
  )
  const [moq, setMoq] = useState(
    group.minimum_order_quantity != null
      ? String(group.minimum_order_quantity)
      : ""
  )
  const [specs, setSpecs] = useState(
    group.specifications ? JSON.stringify(group.specifications, null, 2) : ""
  )

  // Options for the material-type picker. Include the group's current value even
  // if it isn't in the fetched category list (e.g. a previously-created name) so
  // it renders as selected. Backed by the plain Combobox (not CategorySearch,
  // which wires into react-hook-form's Form context this drawer doesn't have).
  const materialTypeOptions = useMemo(() => {
    const base = (materialCategories as any[]).map((c) => ({
      value: c.name,
      label: c.name,
    }))
    if (materialType && !base.some((o) => o.value === materialType)) {
      base.push({ value: materialType, label: materialType })
    }
    return base
  }, [materialCategories, materialType])

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    let specifications: Record<string, unknown> | undefined
    if (specs.trim()) {
      try {
        specifications = JSON.parse(specs)
      } catch {
        toast.error("Specifications must be valid JSON")
        return
      }
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      status,
      composition: composition.trim() || undefined,
      unit_of_measure: unit,
      material_type: materialType.trim() || undefined,
      stock_location_id: locationId || undefined,
      unit_cost: unitCost !== "" ? Number(unitCost) : undefined,
      cost_currency: currency.trim() || undefined,
      lead_time_days: leadTime !== "" ? Number(leadTime) : undefined,
      minimum_order_quantity: moq !== "" ? Number(moq) : undefined,
      ...(specifications ? { specifications } : {}),
    }

    try {
      await mutateAsync(body)
      toast.success("Group updated")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to update group")
    }
  }

  return (
    <Fragment>
      <RouteDrawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
        <Text size="small" className="text-ui-fg-subtle">
          These specs are set once for the group. New colors inherit any field
          they don't already have (fill-blank). To push changes onto colors that
          already exist, run Settings → Data Plumbing → &ldquo;Backfill group
          globals to colors&rdquo;.
        </Text>

        <div className="flex flex-col gap-y-1">
          <Label size="small">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-1">
            <Label size="small">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {STATUS_OPTIONS.map((s) => (
                  <Select.Item key={s} value={s}>
                    {s.replace("_", " ")}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small">Unit of measure</Label>
            <Select value={unit} onValueChange={setUnit}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {UNIT_OPTIONS.map((u) => (
                  <Select.Item key={u} value={u}>
                    {u}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-y-1">
          <Label size="small">Material type (category)</Label>
          <Combobox
            options={materialTypeOptions}
            value={materialType}
            onChange={(v) => setMaterialType((v as string) || "")}
            onCreateOption={(name) => setMaterialType(name)}
            allowClear
            placeholder="Search or create a category"
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <Label size="small">Composition</Label>
          <Input
            value={composition}
            onChange={(e) => setComposition(e.target.value)}
            placeholder="e.g. 100% Cotton"
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <Label size="small">Default receiving location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <Select.Trigger>
              <Select.Value placeholder="Select a location" />
            </Select.Trigger>
            <Select.Content>
              {stock_locations.map((sl: any) => (
                <Select.Item key={sl.id} value={sl.id}>
                  {sl.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-1">
            <Label size="small">Default unit cost</Label>
            <Input
              type="number"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small">Currency</Label>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="e.g. inr"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-1">
            <Label size="small">Lead time (days)</Label>
            <Input
              type="number"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="small">Minimum order quantity</Label>
            <Input
              type="number"
              value={moq}
              onChange={(e) => setMoq(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-y-1">
          <Label size="small">Specifications (JSON)</Label>
          <Textarea
            value={specs}
            onChange={(e) => setSpecs(e.target.value)}
            rows={5}
            placeholder='{ "gsm": 120, "weave": "poplin" }'
          />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary" type="button">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            type="button"
            onClick={onSubmit}
            isLoading={isPending}
          >
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </Fragment>
  )
}
