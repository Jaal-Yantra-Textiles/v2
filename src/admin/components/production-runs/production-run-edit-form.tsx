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
  quantity: z.number().int().min(1).optional(),
  role: z.string().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
})

type FormValues = z.infer<typeof schema>

interface EditProductionRunFormProps {
  run: AdminProductionRun
}

export const EditProductionRunForm = ({ run }: EditProductionRunFormProps) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateProductionRun(run.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: run.quantity ?? undefined,
      role: run.role ?? "",
      run_type: (run.run_type as "production" | "sample") ?? "production",
    },
  })

  const onSubmit = form.handleSubmit(async (data) => {
    const payload: Record<string, any> = {}
    if (data.quantity !== undefined && data.quantity !== run.quantity) {
      payload.quantity = data.quantity
    }
    if ((data.role ?? "") !== (run.role ?? "")) {
      payload.role = data.role || undefined
    }
    if (data.run_type && data.run_type !== run.run_type) {
      payload.run_type = data.run_type
    }
    if (Object.keys(payload).length === 0) {
      handleSuccess()
      return
    }
    try {
      await mutateAsync(payload)
      toast.success("Production run updated")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to update")
    }
  })

  const isOverride = !!run.accepted_at || !!run.started_at

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          {isOverride && (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
              <span className="text-ui-fg-subtle text-xs">
                Run has been accepted/started. Changes apply as an admin override.
              </span>
            </div>
          )}
          <Form.Field
            control={form.control}
            name="run_type"
            render={({ field: { value, onChange, ...rest } }) => (
              <Form.Item>
                <Form.Label>Type</Form.Label>
                <Form.Control>
                  <Select value={value} onValueChange={onChange} {...rest}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="production">Production</Select.Item>
                      <Select.Item value="sample">Sample</Select.Item>
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Quantity</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={1}
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="role"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Role</Form.Label>
                <Form.Control>
                  <Input
                    placeholder="e.g. manufacturing, cutting"
                    {...field}
                    value={field.value ?? ""}
                  />
                </Form.Control>
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
