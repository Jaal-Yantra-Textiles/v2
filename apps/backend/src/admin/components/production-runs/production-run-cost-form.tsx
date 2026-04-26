import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Select, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import {
  AdminProductionRun,
  useUpdateProductionRun,
} from "../../hooks/api/production-runs"

const schema = z.object({
  partner_cost_estimate: z.number().min(0).optional(),
  cost_type: z.enum(["total", "per_unit"]),
})

type FormValues = z.infer<typeof schema>

interface EditCostFormProps {
  run: AdminProductionRun
  initialType?: "total" | "per_unit"
}

export const EditCostForm = ({ run, initialType }: EditCostFormProps) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateProductionRun(run.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      partner_cost_estimate: run.partner_cost_estimate ?? undefined,
      cost_type:
        (initialType as "total" | "per_unit") ||
        ((run.cost_type as "total" | "per_unit") ?? "total"),
    },
  })

  const watchType = form.watch("cost_type")
  const watchAmount = form.watch("partner_cost_estimate")

  const computedTotal =
    watchType === "per_unit" && watchAmount != null && run.produced_quantity
      ? Math.round(Number(watchAmount) * Number(run.produced_quantity) * 100) / 100
      : null

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync({
        partner_cost_estimate:
          data.partner_cost_estimate === undefined
            ? null
            : Number(data.partner_cost_estimate),
        cost_type: data.cost_type,
      })
      toast.success("Cost updated")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to update cost")
    }
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          <Form.Field
            control={form.control}
            name="cost_type"
            render={({ field: { value, onChange, ...rest } }) => (
              <Form.Item>
                <Form.Label>Cost type</Form.Label>
                <Form.Control>
                  <Select value={value} onValueChange={onChange} {...rest}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="total">Total</Select.Item>
                      <Select.Item value="per_unit">Per unit</Select.Item>
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="partner_cost_estimate"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  {watchType === "per_unit" ? "Per-unit amount" : "Total amount"}
                </Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                {computedTotal != null && (
                  <Form.Hint>
                    × {run.produced_quantity} produced = {computedTotal}
                  </Form.Hint>
                )}
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
