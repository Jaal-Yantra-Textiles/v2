import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"

import { Form } from "../../../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useCreatePartnerProductionRun } from "../../../../../hooks/api/partner-production-runs"

const RunCreateSchema = z
  .object({
    quantity: z.coerce.number().int().positive().optional(),
    run_type: z.enum(["production", "sample"]).optional(),
    execution_mode: z.enum(["in_house", "outsourced"]),
    sub_partner_id: z.string().optional(),
  })
  .refine(
    (b) => b.execution_mode !== "outsourced" || !!b.sub_partner_id,
    {
      message: "A sub-partner is required when outsourcing.",
      path: ["sub_partner_id"],
    }
  )
type RunCreateSchema = z.infer<typeof RunCreateSchema>

type Props = { designId: string }

export const RunCreateForm = ({ designId }: Props) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm<RunCreateSchema>({
    defaultValues: {
      quantity: 1,
      run_type: "production",
      execution_mode: "in_house",
      sub_partner_id: "",
    },
    resolver: zodResolver(RunCreateSchema),
  })

  const executionMode = form.watch("execution_mode")
  const { mutateAsync, isPending } = useCreatePartnerProductionRun(designId)

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        quantity: data.quantity,
        run_type: data.run_type,
        execution_mode: data.execution_mode,
        sub_partner_id:
          data.execution_mode === "outsourced"
            ? data.sub_partner_id
            : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Production started")
          handleSuccess()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        className="flex h-full flex-col overflow-hidden"
        onSubmit={handleSubmit}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto">
          <div className="flex w-full max-w-[640px] flex-col gap-y-8 px-2 py-16">
            <div className="flex flex-col gap-y-1">
              <Heading>Create design order</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Start production for this design. The design order is approved
                and ready to work immediately.
              </Text>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="run_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Run type</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="production">Production</Select.Item>
                          <Select.Item value="sample">Sample</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                  </Form.Item>
                )}
              />
            </div>

            <Form.Field
              control={form.control}
              name="execution_mode"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>How is it made?</Form.Label>
                  <Form.Control>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="in_house">
                          In-house (you make it)
                        </Select.Item>
                        <Select.Item value="outsourced">
                          Outsourced (hand to a sub-partner)
                        </Select.Item>
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.Hint>
                    In-house keeps the work with you; outsourced records the
                    vendor for cost tracking.
                  </Form.Hint>
                </Form.Item>
              )}
            />

            {executionMode === "outsourced" && (
              <Form.Field
                control={form.control}
                name="sub_partner_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Sub-partner ID</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="partner_…" />
                    </Form.Control>
                    <Form.Hint>
                      The partner you're handing this production to.
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Create design order
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
