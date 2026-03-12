import { useForm } from "react-hook-form"
import { z } from "@medusajs/framework/zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Text, toast, Select } from "@medusajs/ui"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { Form } from "../../../components/common/form"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { useCreatePaymentReport } from "../../../hooks/api/payment-reports"
import { useWatch } from "react-hook-form"

const schema = z
  .object({
    name: z.string().optional(),
    period_start: z.string().min(1, "Period start is required"),
    period_end: z.string().min(1, "Period end is required"),
    entity_type: z.enum(["all", "partner", "person"]).default("all"),
    entity_id: z.string().optional(),
    status: z
      .enum(["Pending", "Processing", "Completed", "Failed", "Cancelled"])
      .optional(),
    payment_type: z.enum(["Bank", "Cash", "Digital_Wallet"]).optional(),
  })
  .refine(
    (data) => {
      if (data.entity_type !== "all" && !data.entity_id) return false
      return true
    },
    {
      message: "Entity ID is required when entity type is not 'all'",
      path: ["entity_id"],
    },
  )

type FormData = z.infer<typeof schema>

const CreatePaymentReportForm = () => {
  const form = useForm<FormData>({
    defaultValues: {
      name: "",
      period_start: "",
      period_end: "",
      entity_type: "all",
      entity_id: "",
    },
    resolver: zodResolver(schema),
  })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreatePaymentReport()

  const entityType = useWatch({ control: form.control, name: "entity_type" })

  const handleSubmit = form.handleSubmit(async (data) => {
    const payload: any = {
      period_start: data.period_start,
      period_end: data.period_end,
      entity_type: data.entity_type,
    }
    if (data.name) payload.name = data.name
    if (data.entity_type !== "all" && data.entity_id) payload.entity_id = data.entity_id
    if (data.status) payload.status = data.status
    if (data.payment_type) payload.payment_type = data.payment_type

    await mutateAsync(payload, {
      onSuccess: ({ payment_report }) => {
        toast.success("Payment report generated successfully")
        handleSuccess(`/payment-reports/${payment_report.id}`)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              Generate
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Generate Payment Report</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create a persisted snapshot of payment data for a date range.
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Name */}
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item className="md:col-span-2">
                    <Form.Label optional>Report Name</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" placeholder="e.g. Q1 2025 Report" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Period Start */}
              <Form.Field
                control={form.control}
                name="period_start"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Period Start</Form.Label>
                    <Form.Control>
                      <Input type="date" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Period End */}
              <Form.Field
                control={form.control}
                name="period_end"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Period End</Form.Label>
                    <Form.Control>
                      <Input type="date" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Entity Type */}
              <Form.Field
                control={form.control}
                name="entity_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Entity Type</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="all">All</Select.Item>
                          <Select.Item value="partner">Partner</Select.Item>
                          <Select.Item value="person">Person</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Entity ID — only when type != all */}
              {entityType !== "all" && (
                <Form.Field
                  control={form.control}
                  name="entity_id"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>
                        {entityType === "partner" ? "Partner ID" : "Person ID"}
                      </Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              )}

              {/* Status filter */}
              <Form.Field
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Status Filter</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value ?? "__none__"}
                        onValueChange={(v) =>
                          field.onChange(v === "__none__" ? undefined : v)
                        }
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="All statuses" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="__none__">All Statuses</Select.Item>
                          <Select.Item value="Pending">Pending</Select.Item>
                          <Select.Item value="Processing">Processing</Select.Item>
                          <Select.Item value="Completed">Completed</Select.Item>
                          <Select.Item value="Failed">Failed</Select.Item>
                          <Select.Item value="Cancelled">Cancelled</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Payment Type filter */}
              <Form.Field
                control={form.control}
                name="payment_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Payment Type Filter</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value ?? "__none__"}
                        onValueChange={(v) =>
                          field.onChange(v === "__none__" ? undefined : v)
                        }
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="All types" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="__none__">All Types</Select.Item>
                          <Select.Item value="Bank">Bank</Select.Item>
                          <Select.Item value="Cash">Cash</Select.Item>
                          <Select.Item value="Digital_Wallet">Digital Wallet</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

const CreatePaymentReportPage = () => {
  return (
    <RouteFocusModal>
      <CreatePaymentReportForm />
    </RouteFocusModal>
  )
}

export default CreatePaymentReportPage
