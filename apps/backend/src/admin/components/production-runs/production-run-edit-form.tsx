import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Label, Select, Switch, Text, toast } from "@medusajs/ui"
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
  /**
   * #1676 — this run has NO agreed quantity: open-ended, ongoing work.
   *
   * A separate switch rather than "leave the box empty", because an empty box
   * is a person who has not typed yet. Declaring open-endedness removes the
   * ceiling on what may be billed against this run, so it has to be an act,
   * not an omission.
   */
  open_ended: z.boolean().optional(),
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
      open_ended: run.quantity === null,
      role: run.role ?? "",
      run_type: (run.run_type as "production" | "sample") ?? "production",
    },
  })

  const onSubmit = form.handleSubmit(async (data) => {
    const payload: Record<string, any> = {}
    /**
     * `null` is sent DELIBERATELY, and only when the switch is on — the API
     * reads it as "no agreed quantity" rather than as a missing field. An
     * untouched form still sends nothing.
     */
    const nextQuantity = data.open_ended ? null : data.quantity
    const currentQuantity = run.quantity ?? null
    if (nextQuantity !== undefined && nextQuantity !== currentQuantity) {
      payload.quantity = nextQuantity
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
  const openEnded = !!form.watch("open_ended")

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
                    disabled={openEnded}
                    value={openEnded ? "" : (field.value ?? "")}
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
            name="open_ended"
            render={({ field: { value, onChange } }) => (
              <Form.Item>
                <div className="flex items-center gap-x-2">
                  <Switch
                    id="production-run-open-ended"
                    checked={!!value}
                    onCheckedChange={(checked) => onChange(!!checked)}
                  />
                  <Label size="xsmall" htmlFor="production-run-open-ended">
                    No agreed quantity (open-ended)
                  </Label>
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Ongoing work with no fixed order. Payments against this run
                  are not capped at an agreed quantity — nothing will refuse a
                  claim for more than was ordered, because nothing was ordered.
                </Text>
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
