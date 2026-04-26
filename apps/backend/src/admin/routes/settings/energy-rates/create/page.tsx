import { zodResolver } from "@hookform/resolvers/zod"
import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useCreateEnergyRate } from "../../../../hooks/api/energy-rates"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  energyType: z.enum(["energy_electricity", "energy_water", "energy_gas", "labor"]),
  unitOfMeasure: z.enum(["kWh", "Liter", "Cubic_Meter", "Hour", "Other"]),
  ratePerUnit: z.coerce.number().positive("Rate must be positive"),
  currency: z.string().default("inr"),
  effectiveFrom: z.string().min(1, "Effective from date is required"),
  effectiveTo: z.string().optional(),
  region: z.string().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

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

// Default UOM per energy type
const DEFAULT_UOM: Record<string, string> = {
  energy_electricity: "kWh",
  energy_water: "Liter",
  energy_gas: "Cubic_Meter",
  labor: "Hour",
}

const CreateEnergyRateForm = () => {
  const { handleSuccess } = useRouteModal()
  const createRate = useCreateEnergyRate()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: "",
      energyType: "energy_electricity",
      unitOfMeasure: "kWh",
      ratePerUnit: 0,
      currency: "inr",
      effectiveFrom: new Date().toISOString().split("T")[0],
      effectiveTo: "",
      region: "",
      isActive: true,
      notes: "",
    },
  })

  const { register, handleSubmit, setValue, watch, formState: { errors } } = form
  const energyType = watch("energyType")

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createRate.mutateAsync({
        name: values.name,
        energyType: values.energyType,
        unitOfMeasure: values.unitOfMeasure,
        ratePerUnit: values.ratePerUnit,
        currency: values.currency,
        effectiveFrom: new Date(values.effectiveFrom).toISOString(),
        effectiveTo: values.effectiveTo ? new Date(values.effectiveTo).toISOString() : undefined,
        region: values.region || undefined,
        isActive: values.isActive,
        notes: values.notes || undefined,
      })
      toast.success("Energy rate created")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to create energy rate")
    }
  })

  const handleEnergyTypeChange = (value: string) => {
    setValue("energyType", value as any)
    // Auto-set UOM based on type
    const defaultUom = DEFAULT_UOM[value]
    if (defaultUom) {
      setValue("unitOfMeasure", defaultUom as any)
    }
  }

  return (
    <RouteFocusModal.Form form={form as any}>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" type="button">Cancel</Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={createRate.isPending}>
              Save
            </Button>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Energy Rate</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Set a cost rate for energy consumption or labor hours
              </Text>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="e.g. India Industrial Electricity" {...register("name")} />
                {errors.name && <Text size="xsmall" className="text-ui-fg-error mt-1">{errors.name.message}</Text>}
              </div>

              <div>
                <Label htmlFor="energyType">Type</Label>
                <Select value={energyType} onValueChange={handleEnergyTypeChange}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select type" />
                  </Select.Trigger>
                  <Select.Content>
                    {ENERGY_TYPE_OPTIONS.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label htmlFor="unitOfMeasure">Unit of Measure</Label>
                <Select value={watch("unitOfMeasure")} onValueChange={(v) => setValue("unitOfMeasure", v as any)}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {UOM_OPTIONS.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label htmlFor="ratePerUnit">Rate per Unit</Label>
                <Input id="ratePerUnit" type="number" step="0.01" min="0" placeholder="0.00" {...register("ratePerUnit")} />
                {errors.ratePerUnit && <Text size="xsmall" className="text-ui-fg-error mt-1">{errors.ratePerUnit.message}</Text>}
              </div>

              <div>
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" placeholder="inr" {...register("currency")} />
              </div>

              <div>
                <Label htmlFor="effectiveFrom">Effective From</Label>
                <Input id="effectiveFrom" type="date" {...register("effectiveFrom")} />
                {errors.effectiveFrom && <Text size="xsmall" className="text-ui-fg-error mt-1">{errors.effectiveFrom.message}</Text>}
              </div>

              <div>
                <Label htmlFor="effectiveTo">Effective To</Label>
                <Input id="effectiveTo" type="date" {...register("effectiveTo")} />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">Leave empty for open-ended</Text>
              </div>

              <div>
                <Label htmlFor="region">Region</Label>
                <Input id="region" placeholder="e.g. Maharashtra, India" {...register("region")} />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">Optional geographic scope</Text>
              </div>

              <div className="flex items-center gap-x-3 pt-6">
                <Switch
                  id="isActive"
                  checked={watch("isActive")}
                  onCheckedChange={(checked) => setValue("isActive", checked)}
                />
                <Label htmlFor="isActive">Active</Label>
              </div>

              <div className="col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" placeholder="Optional notes about this rate" {...register("notes")} />
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </form>
    </RouteFocusModal.Form>
  )
}

export default function CreateEnergyRateModal() {
  return (
    <RouteFocusModal>
      <CreateEnergyRateForm />
    </RouteFocusModal>
  )
}
