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
const visualFlowSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    trigger_type: z.enum(["manual", "webhook", "event", "schedule", "another_flow"]),
    event_type: z.string().optional(),
    schedule_mode: z.enum(["daily_time", "every_n_hours", "cron"]).optional(),
    schedule_time: z.string().optional(),
    schedule_every_hours: z.coerce.number().int().min(1).max(24).optional(),
    schedule_cron: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.trigger_type !== "schedule") {
      return
    }

    if (!data.schedule_mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Schedule type is required",
        path: ["schedule_mode"],
      })
      return
    }

    if (data.schedule_mode === "daily_time") {
      if (!data.schedule_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Time is required",
          path: ["schedule_time"],
        })
      }
    }

    if (data.schedule_mode === "every_n_hours") {
      if (data.schedule_every_hours === undefined || Number.isNaN(data.schedule_every_hours)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hours interval is required",
          path: ["schedule_every_hours"],
        })
      }
    }

    if (data.schedule_mode === "cron") {
      if (!data.schedule_cron) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cron expression is required",
          path: ["schedule_cron"],
        })
        return
      }

      const cron = data.schedule_cron.trim()
      const isValidCron = /^(\S+\s+){4}\S+$/.test(cron)
      if (!isValidCron) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cron expression must have 5 parts",
          path: ["schedule_cron"],
        })
      }
    }
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
      schedule_mode: "daily_time",
      schedule_time: "",
      schedule_every_hours: undefined,
      schedule_cron: "",
    },
  })

  const { 
    handleSubmit, 
    formState: { errors },
    watch,
  } = form

  const triggerType = watch("trigger_type")
  const scheduleMode = watch("schedule_mode")

  // Form submission handler
  const onSubmit = handleSubmit(async (data) => {
    try {
      // Build trigger_config based on trigger type
      let trigger_config: Record<string, any> = {}
      if (data.trigger_type === "event" && data.event_type) {
        trigger_config = { event_type: data.event_type }
      } else if (data.trigger_type === "schedule") {
        if (data.schedule_mode === "daily_time" && data.schedule_time) {
          const [hourStr, minuteStr] = data.schedule_time.split(":")
          const hour = Number(hourStr)
          const minute = Number(minuteStr)

          if (
            Number.isNaN(hour) ||
            Number.isNaN(minute) ||
            hour < 0 ||
            hour > 23 ||
            minute < 0 ||
            minute > 59
          ) {
            throw new Error("Invalid schedule time")
          }

          trigger_config = { cron: `${minute} ${hour} * * *` }
        }

        if (
          data.schedule_mode === "every_n_hours" &&
          data.schedule_every_hours !== undefined
        ) {
          trigger_config = { cron: `0 */${data.schedule_every_hours} * * *` }
        }

        if (data.schedule_mode === "cron" && data.schedule_cron) {
          trigger_config = { cron: data.schedule_cron.trim() }
        }
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

              {/* Schedule Time field - shown when trigger_type is "schedule" */}
              {triggerType === "schedule" && (
                <div className="flex flex-col gap-y-4">
                  <Form.Field
                    control={form.control}
                    name="schedule_mode"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>Schedule</Form.Label>
                          <Form.Control>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <Select.Trigger>
                                <Select.Value placeholder="Select schedule..." />
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Item value="daily_time">Daily at a time</Select.Item>
                                <Select.Item value="every_n_hours">Every N hours</Select.Item>
                                <Select.Item value="cron">Advanced (cron)</Select.Item>
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          {errors.schedule_mode && (
                            <Form.ErrorMessage>{errors.schedule_mode.message}</Form.ErrorMessage>
                          )}
                        </Form.Item>
                      )
                    }}
                  />

                  {scheduleMode === "daily_time" && (
                    <Form.Field
                      control={form.control}
                      name="schedule_time"
                      render={({ field }) => {
                        return (
                          <Form.Item>
                            <Form.Label>Time</Form.Label>
                            <Form.Control>
                              <Input type="time" {...field} />
                            </Form.Control>
                            {errors.schedule_time && (
                              <Form.ErrorMessage>{errors.schedule_time.message}</Form.ErrorMessage>
                            )}
                            <Form.Hint>Runs daily at the selected time.</Form.Hint>
                          </Form.Item>
                        )
                      }}
                    />
                  )}

                  {scheduleMode === "every_n_hours" && (
                    <Form.Field
                      control={form.control}
                      name="schedule_every_hours"
                      render={({ field }) => {
                        return (
                          <Form.Item>
                            <Form.Label>Every (hours)</Form.Label>
                            <Form.Control>
                              <Input
                                type="number"
                                min={1}
                                max={24}
                                step={1}
                                value={(field.value as any) ?? ""}
                                onChange={(e) => field.onChange(e.target.value)}
                              />
                            </Form.Control>
                            {errors.schedule_every_hours && (
                              <Form.ErrorMessage>
                                {errors.schedule_every_hours.message as any}
                              </Form.ErrorMessage>
                            )}
                            <Form.Hint>
                              Example: 2 means every 2 hours (cron: "0 */2 * * *").
                            </Form.Hint>
                          </Form.Item>
                        )
                      }}
                    />
                  )}

                  {scheduleMode === "cron" && (
                    <Form.Field
                      control={form.control}
                      name="schedule_cron"
                      render={({ field }) => {
                        return (
                          <Form.Item>
                            <Form.Label>Cron Expression</Form.Label>
                            <Form.Control>
                              <Input
                                placeholder="0 */6 * * *"
                                className="font-mono"
                                {...field}
                              />
                            </Form.Control>
                            {errors.schedule_cron && (
                              <Form.ErrorMessage>{errors.schedule_cron.message}</Form.ErrorMessage>
                            )}
                            <Form.Hint>
                              Examples: "0 9 * * *" (daily at 9am), "0 */6 * * *" (every 6 hours)
                            </Form.Hint>
                          </Form.Item>
                        )
                      }}
                    />
                  )}
                </div>
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
