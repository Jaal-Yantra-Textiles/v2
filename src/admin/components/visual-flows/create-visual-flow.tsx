import { Button, Heading, Text, Input, Textarea, toast, Select } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { useCreateVisualFlow, useFlowMetadata } from "../../hooks/api/visual-flows"
import { useRouteModal } from "../modal/use-route-modal"
import { Form } from "../common/form"

// Define the schema for visual flow creation
const visualFlowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  trigger_type: z.enum(["manual", "webhook", "event", "schedule", "another_flow"]),
  event_type: z.string().optional(),
  cron_expression: z.string().optional(),
})

type VisualFlowFormValues = z.infer<typeof visualFlowSchema>

export function CreateVisualFlow() {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreateVisualFlow()
  const { data: metadata } = useFlowMetadata()
  
  // Get events from metadata, grouped by category
  const events = metadata?.events || []
  const eventsByCategory = events.reduce((acc: Record<string, typeof events>, event) => {
    const cat = event.category || "other"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(event)
    return acc
  }, {})

  // Initialize form with validation
  const form = useForm<VisualFlowFormValues>({
    resolver: zodResolver(visualFlowSchema),
    defaultValues: {
      name: "",
      description: "",
      trigger_type: "manual",
      event_type: "",
      cron_expression: "",
    },
  })

  const { 
    handleSubmit, 
    formState: { errors },
    watch,
  } = form

  const triggerType = watch("trigger_type")

  // Form submission handler
  const onSubmit = handleSubmit(async (data) => {
    try {
      // Build trigger_config based on trigger type
      let trigger_config: Record<string, any> = {}
      if (data.trigger_type === "event" && data.event_type) {
        trigger_config = { event_type: data.event_type }
      } else if (data.trigger_type === "schedule" && data.cron_expression) {
        trigger_config = { cron: data.cron_expression }
      }
      
      await mutateAsync(
        {
          name: data.name,
          description: data.description || undefined,
          trigger_type: data.trigger_type,
          trigger_config: Object.keys(trigger_config).length > 0 ? trigger_config : undefined,
          status: "draft",
        },
        {
          onSuccess: (flow) => {
            toast.success(`Flow "${flow.name}" created successfully`)
            handleSuccess(`/visual-flows/${flow.id}`)
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create flow")
          },
        }
      )
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred")
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit()
          }
        }}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Visual Flow</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Set up a new automated workflow with a visual editor
              </Text>
            </div>
            
            <div className="flex flex-col gap-y-4">
              {/* Name field */}
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>Flow Name</Form.Label>
                      <Form.Control>
                        <Input 
                          placeholder="Enter flow name" 
                          {...field}
                        />
                      </Form.Control>
                      {errors.name && (
                        <Form.ErrorMessage>{errors.name.message}</Form.ErrorMessage>
                      )}
                    </Form.Item>
                  )
                }}
              />
              
              {/* Description field */}
              <Form.Field
                control={form.control}
                name="description"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>Description</Form.Label>
                      <Form.Control>
                        <Textarea 
                          placeholder="Describe what this flow does" 
                          rows={3}
                          {...field}
                        />
                      </Form.Control>
                      {errors.description && (
                        <Form.ErrorMessage>{errors.description.message}</Form.ErrorMessage>
                      )}
                    </Form.Item>
                  )
                }}
              />

              {/* Trigger Type field */}
              <Form.Field
                control={form.control}
                name="trigger_type"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>Trigger Type</Form.Label>
                      <Form.Control>
                        <Select 
                          value={field.value} 
                          onValueChange={field.onChange}
                        >
                          <Select.Trigger>
                            <Select.Value placeholder="Select trigger type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="manual">
                              Manual - Trigger manually from admin
                            </Select.Item>
                            <Select.Item value="webhook">
                              Webhook - Trigger via HTTP request
                            </Select.Item>
                            <Select.Item value="event">
                              Event - Trigger on data changes
                            </Select.Item>
                            <Select.Item value="schedule">
                              Schedule - Trigger on a schedule
                            </Select.Item>
                            <Select.Item value="another_flow">
                              Another Flow - Trigger from another flow
                            </Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.Hint>
                        {triggerType === "manual" && "You can manually execute this flow from the admin panel."}
                        {triggerType === "webhook" && "External services can trigger this flow via a webhook URL."}
                        {triggerType === "event" && "This flow will run when specific data changes occur."}
                        {triggerType === "schedule" && "This flow will run on a configured schedule."}
                        {triggerType === "another_flow" && "This flow can be triggered by other flows."}
                      </Form.Hint>
                    </Form.Item>
                  )
                }}
              />

              {/* Event Type field - shown when trigger_type is "event" */}
              {triggerType === "event" && (
                <Form.Field
                  control={form.control}
                  name="event_type"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Label>Event Type</Form.Label>
                        <Form.Control>
                          <Select 
                            value={field.value || ""} 
                            onValueChange={field.onChange}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select event to listen for..." />
                            </Select.Trigger>
                            <Select.Content className="max-h-64 overflow-y-auto">
                              {Object.entries(eventsByCategory).map(([category, categoryEvents]) => (
                                <Select.Group key={category}>
                                  <Text className="px-2 py-1 text-xs text-ui-fg-muted capitalize font-medium">
                                    {category}
                                  </Text>
                                  {(categoryEvents as any[]).map((event) => (
                                    <Select.Item key={event.name} value={event.name}>
                                      <div className="flex flex-col">
                                        <span className="font-mono text-sm">{event.name}</span>
                                        <span className="text-xs text-ui-fg-subtle">{event.description}</span>
                                      </div>
                                    </Select.Item>
                                  ))}
                                </Select.Group>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.Hint>
                          Select the Medusa event that will trigger this flow
                        </Form.Hint>
                      </Form.Item>
                    )
                  }}
                />
              )}

              {/* Cron Expression field - shown when trigger_type is "schedule" */}
              {triggerType === "schedule" && (
                <Form.Field
                  control={form.control}
                  name="cron_expression"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Label>Cron Expression</Form.Label>
                        <Form.Control>
                          <Input 
                            placeholder="0 9 * * *" 
                            className="font-mono"
                            {...field}
                          />
                        </Form.Control>
                        <Form.Hint>
                          Examples: "0 9 * * *" (daily at 9am), "0 */6 * * *" (every 6 hours)
                        </Form.Hint>
                      </Form.Item>
                    )
                  }}
                />
              )}
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
            <Button
              type="submit"
              size="small"
              isLoading={isPending}
            >
              Create Flow
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
