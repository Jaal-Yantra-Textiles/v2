import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { Plus, Trash, ArrowUpDown } from "@medusajs/icons"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useState, useEffect, useMemo } from "react"
import { useInventoryItem, useSplitInventoryItem } from "../hooks/api/raw-materials"
import { useStockLocations } from "../hooks/api/stock_location"

type AdminInventory = {
  id: string
  title?: string
}

const splitFormSchema = z.object({
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  new_title: z.string().min(1, "Title is required"),
  location_id: z.string().min(1, "Stock location is required"),
  name: z.string().optional(),
  color: z.string().optional(),
  composition: z.string().optional(),
  grade: z.string().optional(),
  description: z.string().optional(),
  customProps: z.array(
    z.object({
      key: z.string().min(1, "Key is required"),
      value: z.string(),
    })
  ),
})

type SplitFormValues = z.infer<typeof splitFormSchema>

const InventorySplitWidget = ({ data }: DetailWidgetProps<AdminInventory>) => {
  const [open, setOpen] = useState(false)

  const { inventory_item, isPending } = useInventoryItem(data.id, {
    fields: "+raw_materials.*,+raw_materials.material_type.*,+location_levels.*",
  })

  const { stock_locations = [] } = useStockLocations({ limit: 50 })

  const { mutate: splitInventory, isPending: isSplitting } =
    useSplitInventoryItem(data.id)

  const sourceItem = inventory_item as any
  const rawMaterial = sourceItem?.raw_materials ?? null
  const locationLevels: Array<{
    id: string
    location_id: string
    stocked_quantity: number
  }> = sourceItem?.location_levels ?? []

  // Map location_id → human name
  const locationNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const loc of stock_locations as any[]) {
      map[loc.id] = loc.name ?? loc.id
    }
    return map
  }, [stock_locations])

  const totalStocked = locationLevels.reduce(
    (sum, l) => sum + (Number(l.stocked_quantity) || 0),
    0
  )

  // Levels that actually have stock (only these are selectable)
  const stockedLevels = locationLevels.filter(
    (l) => Number(l.stocked_quantity) > 0
  )

  // Extract custom properties from source raw material specifications
  const builtInKeys = ["color", "composition", "grade", "name", "description"]
  const sourceCustomProps = rawMaterial?.specifications
    ? Object.entries(rawMaterial.specifications as Record<string, any>)
        .filter(([k]) => !builtInKeys.includes(k))
        .map(([key, value]) => ({ key, value: String(value) }))
    : []

  const defaultLocationId = stockedLevels[0]?.location_id ?? ""

  const form = useForm<SplitFormValues>({
    resolver: zodResolver(splitFormSchema),
    defaultValues: {
      quantity: 1,
      new_title: sourceItem?.title ? `${sourceItem.title} (Split)` : "(Split)",
      location_id: defaultLocationId,
      name: rawMaterial?.name ?? "",
      color: rawMaterial?.color ?? "",
      composition: rawMaterial?.composition ?? "",
      grade: rawMaterial?.grade ?? "",
      description: rawMaterial?.description ?? "",
      customProps: sourceCustomProps,
    },
  })

  // Reset form defaults when inventory item loads
  useEffect(() => {
    if (!sourceItem) return
    form.reset({
      quantity: 1,
      new_title: sourceItem.title ? `${sourceItem.title} (Split)` : "(Split)",
      location_id: stockedLevels[0]?.location_id ?? "",
      name: rawMaterial?.name ?? "",
      color: rawMaterial?.color ?? "",
      composition: rawMaterial?.composition ?? "",
      grade: rawMaterial?.grade ?? "",
      description: rawMaterial?.description ?? "",
      customProps: sourceCustomProps,
    })
  }, [sourceItem?.id, rawMaterial?.id])

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "customProps",
  })

  const handleOpen = () => {
    form.reset({
      quantity: 1,
      new_title: sourceItem?.title ? `${sourceItem.title} (Split)` : "(Split)",
      location_id: stockedLevels[0]?.location_id ?? "",
      name: rawMaterial?.name ?? "",
      color: rawMaterial?.color ?? "",
      composition: rawMaterial?.composition ?? "",
      grade: rawMaterial?.grade ?? "",
      description: rawMaterial?.description ?? "",
      customProps: sourceCustomProps,
    })
    setOpen(true)
  }

  const selectedLocationId = form.watch("location_id")
  const selectedLevel = locationLevels.find(
    (l) => l.location_id === selectedLocationId
  )
  const availableAtLocation = Number(selectedLevel?.stocked_quantity) || 0

  const onSubmit = (values: SplitFormValues) => {
    const extra: Record<string, string> = {}
    for (const { key, value } of values.customProps) {
      if (key.trim()) {
        extra[key.trim()] = value
      }
    }

    splitInventory(
      {
        quantity: values.quantity,
        new_title: values.new_title,
        location_id: values.location_id,
        raw_material_overrides: {
          name: values.name || undefined,
          color: values.color || undefined,
          composition: values.composition || undefined,
          grade: values.grade || undefined,
          description: values.description || undefined,
          extra: Object.keys(extra).length ? extra : undefined,
        },
      },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success("Split inventory item created successfully")
        },
        onError: (err) => {
          toast.error(err?.message ?? "Failed to split inventory item")
        },
      }
    )
  }

  const quantityValue = form.watch("quantity")
  const quantityError = form.formState.errors.quantity
  const locationError = form.formState.errors.location_id

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Split Inventory</Heading>
            <Text className="text-ui-fg-subtle text-sm mt-1">
              {isPending
                ? "Loading..."
                : `${totalStocked} unit${totalStocked !== 1 ? "s" : ""} available across ${locationLevels.length} location${locationLevels.length !== 1 ? "s" : ""}`}
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={handleOpen}
            disabled={isPending || totalStocked === 0}
          >
            <ArrowUpDown className="mr-1" />
            Split
          </Button>
        </div>
        {locationLevels.length > 0 && (
          <div className="px-6 py-3 flex flex-wrap gap-2">
            {locationLevels.map((lvl) => (
              <span
                key={lvl.location_id}
                className="inline-flex items-center rounded-full border border-ui-border-base bg-ui-bg-subtle px-2.5 py-0.5 text-xs text-ui-fg-base"
              >
                {locationNameMap[lvl.location_id] ?? lvl.location_id} × {lvl.stocked_quantity}
              </span>
            ))}
          </div>
        )}
      </Container>

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <Heading level="h2">Split Inventory</Heading>
          </FocusModal.Header>

          <FocusModal.Body className="overflow-y-auto flex items-start justify-center">
            <div className="flex flex-col gap-y-8 w-full max-w-2xl px-6 py-8">
            {/* Split Details */}
            <section className="flex flex-col gap-y-4">
              <Heading level="h3" className="text-ui-fg-base">
                Split Details
              </Heading>

              <div className="grid grid-cols-1 gap-4">
                {/* Stock location */}
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="location_id" className="text-sm font-medium">
                    Stock location
                  </Label>
                  {stockedLevels.length === 0 ? (
                    <Text className="text-ui-fg-error text-xs">
                      No locations have stock available.
                    </Text>
                  ) : (
                    <select
                      id="location_id"
                      {...form.register("location_id")}
                      className="flex h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1 text-sm text-ui-fg-base shadow-buttons-neutral outline-none transition-all focus:border-ui-border-interactive focus:shadow-borders-focus disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {stockedLevels.map((lvl) => (
                        <option key={lvl.location_id} value={lvl.location_id}>
                          {locationNameMap[lvl.location_id] ?? lvl.location_id} — {lvl.stocked_quantity} in stock
                        </option>
                      ))}
                    </select>
                  )}
                  {locationError && (
                    <Text className="text-ui-fg-error text-xs">
                      {locationError.message}
                    </Text>
                  )}
                </div>

                {/* Quantity */}
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="quantity" className="text-sm font-medium">
                    Quantity to split
                  </Label>
                  <div className="flex items-center gap-x-2">
                    <Input
                      id="quantity"
                      type="number"
                      min={1}
                      max={availableAtLocation}
                      {...form.register("quantity", { valueAsNumber: true })}
                      className="max-w-[120px]"
                    />
                    <Text className="text-ui-fg-subtle text-sm">
                      Available at location: {availableAtLocation} unit{availableAtLocation !== 1 ? "s" : ""}
                    </Text>
                  </div>
                  {quantityError && (
                    <Text className="text-ui-fg-error text-xs">
                      {quantityError.message}
                    </Text>
                  )}
                  {!quantityError && quantityValue > availableAtLocation && (
                    <Text className="text-ui-fg-error text-xs">
                      Cannot split more than available at this location ({availableAtLocation})
                    </Text>
                  )}
                </div>

                {/* New title */}
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="new_title" className="text-sm font-medium">
                    New Title
                  </Label>
                  <Input
                    id="new_title"
                    {...form.register("new_title")}
                    placeholder="Enter title for new inventory item"
                  />
                  {form.formState.errors.new_title && (
                    <Text className="text-ui-fg-error text-xs">
                      {form.formState.errors.new_title.message}
                    </Text>
                  )}
                </div>
              </div>
            </section>

            {/* Raw Material */}
            <section className="flex flex-col gap-y-4">
              <div className="flex items-center justify-between">
                <Heading level="h3" className="text-ui-fg-base">
                  Raw Material
                </Heading>
                {!rawMaterial && (
                  <Text className="text-ui-fg-subtle text-xs italic">
                    No raw material linked — a new one will be created with the title only
                  </Text>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="rm_name" className="text-sm font-medium">
                    Name
                  </Label>
                  <Input
                    id="rm_name"
                    {...form.register("name")}
                    placeholder="Raw material name"
                  />
                </div>

                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="rm_color" className="text-sm font-medium">
                    Color
                  </Label>
                  <Input
                    id="rm_color"
                    {...form.register("color")}
                    placeholder="e.g. Black"
                  />
                </div>

                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="rm_composition" className="text-sm font-medium">
                    Composition
                  </Label>
                  <Input
                    id="rm_composition"
                    {...form.register("composition")}
                    placeholder="e.g. 100% Linen"
                  />
                </div>

                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="rm_grade" className="text-sm font-medium">
                    Grade
                  </Label>
                  <Input
                    id="rm_grade"
                    {...form.register("grade")}
                    placeholder="e.g. A"
                  />
                </div>

                <div className="col-span-2 flex flex-col gap-y-1">
                  <Label htmlFor="rm_description" className="text-sm font-medium">
                    Description
                  </Label>
                  <Textarea
                    id="rm_description"
                    {...form.register("description")}
                    placeholder="Description"
                    rows={3}
                  />
                </div>
              </div>
            </section>

            {/* Custom Properties */}
            <section className="flex flex-col gap-y-4">
              <div className="flex items-center justify-between">
                <Heading level="h3" className="text-ui-fg-base">
                  Custom Properties
                </Heading>
                <Button
                  type="button"
                  size="small"
                  variant="transparent"
                  onClick={() => append({ key: "", value: "" })}
                >
                  <Plus className="mr-1" />
                  Add property
                </Button>
              </div>

              {fields.length > 0 && (
                <div className="flex flex-col gap-y-2">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-ui-fg-subtle px-1">
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
                    >
                      <Input
                        {...form.register(`customProps.${index}.key`)}
                        placeholder="Key"
                        size="small"
                      />
                      <Input
                        {...form.register(`customProps.${index}.value`)}
                        placeholder="Value"
                        size="small"
                      />
                      <Button
                        type="button"
                        size="small"
                        variant="transparent"
                        onClick={() => remove(index)}
                        className="text-ui-fg-subtle hover:text-ui-fg-error"
                      >
                        <Trash />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {fields.length === 0 && (
                <Text className="text-ui-fg-muted text-sm italic">
                  No custom properties. Click &quot;Add property&quot; to add one.
                </Text>
              )}
            </section>
            </div>
          </FocusModal.Body>

          <FocusModal.Footer>
            <div className="flex justify-end gap-x-2 w-full">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={isSplitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={isSplitting || quantityValue > availableAtLocation || !selectedLocationId}
                isLoading={isSplitting}
                onClick={form.handleSubmit(onSubmit)}
              >
                Split Inventory
              </Button>
            </div>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "inventory_item.details.side.after",
})

export default InventorySplitWidget
