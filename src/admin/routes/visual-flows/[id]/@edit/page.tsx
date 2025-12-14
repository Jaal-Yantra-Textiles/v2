import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
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

type EditVisualFlowDrawerContentProps = {
  form: ReturnType<typeof useForm<EditFlowFormValues>>
  mutateAsync: ReturnType<typeof useUpdateVisualFlow>["mutateAsync"]
  isPending: boolean
}

const EditVisualFlowDrawerContent = ({
  form,
  mutateAsync,
  isPending,
}: EditVisualFlowDrawerContentProps) => {
  const { handleSuccess } = useRouteModal()

  const onSubmit = form.handleSubmit(async (data) => {
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

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Header />
        <RouteDrawer.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
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
                    {form.formState.errors.name && (
                      <Form.ErrorMessage>
                        {form.formState.errors.name.message}
                      </Form.ErrorMessage>
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
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button type="submit" size="small" isLoading={isPending}>
              Save Changes
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}

const EditVisualFlowPage = () => {
  const { id } = useParams<{ id: string }>()
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

  if (isLoading || !flow) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header />
        <RouteDrawer.Body className="flex items-center justify-center py-16">
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <EditVisualFlowDrawerContent
        form={form}
        mutateAsync={mutateAsync}
        isPending={isPending}
      />
    </RouteDrawer>
  )
}

export default EditVisualFlowPage
