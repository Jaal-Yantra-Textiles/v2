import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useVisualFlow, useUpdateVisualFlow } from "../../../../hooks/api/visual-flows"
import { Button, Heading, Text, Input, Textarea, toast, Select } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { KeyboundForm } from "../../../../components/utilitites/key-bound-form"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { Form } from "../../../../components/common/form"

const editFlowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  trigger_type: z.enum(["manual", "webhook", "event", "schedule", "another_flow"]),
  status: z.enum(["active", "inactive", "draft"]),
})

type EditFlowFormValues = z.infer<typeof editFlowSchema>

const EditVisualFlowPage = () => {
  const { id } = useParams<{ id: string }>()
  const { handleSuccess } = useRouteModal()
  const { data: flow, isLoading } = useVisualFlow(id!)
  const { mutateAsync, isPending } = useUpdateVisualFlow(id!)

  const form = useForm<EditFlowFormValues>({
    resolver: zodResolver(editFlowSchema),
    values: flow ? {
      name: flow.name,
      description: flow.description || "",
      trigger_type: flow.trigger_type,
      status: flow.status,
    } : undefined,
  })

  const { handleSubmit, formState: { errors } } = form

  const onSubmit = handleSubmit(async (data) => {
    try {
      await mutateAsync(
        {
          name: data.name,
          description: data.description || undefined,
          trigger_type: data.trigger_type,
          status: data.status,
        },
        {
          onSuccess: () => {
            toast.success("Flow updated successfully")
            handleSuccess()
          },
          onError: (error) => {
            toast.error(error.message || "Failed to update flow")
          },
        }
      )
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred")
    }
  })

  if (isLoading || !flow) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex items-center justify-center py-16">
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Form form={form}>
        <KeyboundForm
          onSubmit={onSubmit}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <RouteFocusModal.Header />
          <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8">
              <div>
                <Heading>Edit Flow</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Update flow settings
                </Text>
              </div>
              
              <div className="flex flex-col gap-y-4">
                <Form.Field
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Flow Name</Form.Label>
                      <Form.Control>
                        <Input placeholder="Enter flow name" {...field} />
                      </Form.Control>
                      {errors.name && (
                        <Form.ErrorMessage>{errors.name.message}</Form.ErrorMessage>
                      )}
                    </Form.Item>
                  )}
                />
                
                <Form.Field
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>Description</Form.Label>
                      <Form.Control>
                        <Textarea 
                          placeholder="Describe what this flow does" 
                          rows={3}
                          {...field}
                        />
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Status</Form.Label>
                      <Form.Control>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select status" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="draft">Draft</Select.Item>
                            <Select.Item value="active">Active</Select.Item>
                            <Select.Item value="inactive">Inactive</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="trigger_type"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Trigger Type</Form.Label>
                      <Form.Control>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select trigger type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="manual">Manual</Select.Item>
                            <Select.Item value="webhook">Webhook</Select.Item>
                            <Select.Item value="event">Event</Select.Item>
                            <Select.Item value="schedule">Schedule</Select.Item>
                            <Select.Item value="another_flow">Another Flow</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                    </Form.Item>
                  )}
                />
              </div>
            </div>
          </RouteFocusModal.Body>
          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button variant="secondary" size="small">
                  Cancel
                </Button>
              </RouteFocusModal.Close>
              <Button type="submit" size="small" isLoading={isPending}>
                Save Changes
              </Button>
            </div>
          </RouteFocusModal.Footer>
        </KeyboundForm>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  )
}

export default EditVisualFlowPage
