import { zodResolver } from "@hookform/resolvers/zod"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { z } from "@medusajs/framework/zod"

import { Form } from "../../../../components/common/form"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"

import { usePartners } from "../../../../hooks/api/partners"
import { useTaskTemplates } from "../../../../hooks/api/task-templates"
import {
  useCreateDesignProductionRun,
  useSendProductionRunToProduction,
} from "../../../../hooks/api/production-runs"

const assignmentSchema = z.object({
  partner_id: z.string().min(1, "Partner is required"),
  role: z.string().optional(),
  quantity: z.coerce.number().positive("Quantity must be > 0"),
})

const createSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  assignments: z.array(assignmentSchema).optional(),
  send_to_production: z.boolean().optional(),
  template_names: z.array(z.string()).optional(),
})

type FormValues = z.infer<typeof createSchema>

const CreateProductionRunDrawerForm = () => {
  const { id: designId } = useParams()
  const { handleSuccess } = useRouteModal()

  const form = useForm<FormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      quantity: undefined,
      assignments: [],
      send_to_production: false,
      template_names: [],
    },
  })

  const sendToProduction = form.watch("send_to_production")
  const selectedTemplateNames = form.watch("template_names") || []

  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const { task_templates: taskTemplates = [] } = useTaskTemplates({ limit: 100, offset: 0 })

  const templatesToShow = useMemo(() => {
    return [...(taskTemplates || [])].sort((a: any, b: any) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    )
  }, [taskTemplates])

  const { mutateAsync: createRun, isPending: isCreating } = useCreateDesignProductionRun(
    designId || "",
  )

  const sendMutation = useSendProductionRunToProduction()

  const addAssignment = () => {
    const existing = form.getValues("assignments") || []
    form.setValue(
      "assignments",
      [...existing, { partner_id: "", role: "", quantity: 1 }],
      { shouldDirty: true }
    )
  }

  const removeAssignment = (idx: number) => {
    const existing = form.getValues("assignments") || []
    form.setValue(
      "assignments",
      existing.filter((_, i) => i !== idx),
      { shouldDirty: true }
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!designId) {
      toast.error("Missing design id")
      return
    }

    if (
      values.send_to_production &&
      (!values.template_names || !values.template_names.length)
    ) {
      toast.error("Select at least one task template")
      return
    }

    try {
      const res = await createRun({
        quantity: values.quantity,
        assignments: values.assignments?.length ? values.assignments : undefined,
      })

      toast.success("Production run created")

      if (!values.send_to_production) {
        handleSuccess()
        return
      }

      const children = (res as any)?.children as any[] | undefined
      const parent = (res as any)?.production_run as any

      const runsToSend = (children?.length ? children : [parent]).filter(
        (r: any) => r?.partner_id
      )

      if (!runsToSend.length) {
        toast.error("No partner-assigned runs to send")
        return
      }

      for (const run of runsToSend) {
        await sendMutation.mutateAsync({
          run_id: String(run.id),
          template_names: values.template_names || [],
        })
      }

      toast.success("Sent to production")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed")
    }
  })

  const assignments = form.watch("assignments") || []

  return (
    <RouteDrawer.Form form={form}>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteDrawer.Header>
          <Heading>Create Production Run</Heading>
        </RouteDrawer.Header>

        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto py-6">
          <div className="flex flex-col gap-y-6">
            <Container className="divide-y p-0">
              <div className="px-6 py-4">
                <Heading level="h2">Quantity</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Optional parent quantity. If using assignments, their quantities should sum to this.
                </Text>
              </div>

              <div className="px-6 py-4">
                <Form.Field
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>Quantity</Form.Label>
                      <Form.Control>
                        <Input type="number" min={1} {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </Container>

            <Container className="divide-y p-0">
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <Heading level="h2">Assignments</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Optional. Add one or more partner assignments to create child runs.
                  </Text>
                </div>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={addAssignment}
                >
                  Add
                </Button>
              </div>

              <div className="px-6 py-4 flex flex-col gap-y-4">
                {!assignments.length ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    No assignments
                  </Text>
                ) : (
                  assignments.map((_, idx) => (
                    <div key={idx} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <Text size="small" weight="plus">
                          Assignment {idx + 1}
                        </Text>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          onClick={() => removeAssignment(idx)}
                        >
                          Remove
                        </Button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Form.Field
                          control={form.control}
                          name={`assignments.${idx}.partner_id` as any}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Partner</Form.Label>
                              <Form.Control>
                                <Select
                                  value={(field.value as string) || ""}
                                  onValueChange={field.onChange}
                                >
                                  <Select.Trigger>
                                    <Select.Value placeholder="Select partner" />
                                  </Select.Trigger>
                                  <Select.Content>
                                    {(partners || []).map((p: any) => (
                                      <Select.Item key={String(p.id)} value={String(p.id)}>
                                        {String(p.name || p.handle || p.id)}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select>
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />

                        <Form.Field
                          control={form.control}
                          name={`assignments.${idx}.role` as any}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label optional>Role</Form.Label>
                              <Form.Control>
                                <Input placeholder="e.g. cutter" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />

                        <Form.Field
                          control={form.control}
                          name={`assignments.${idx}.quantity` as any}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Quantity</Form.Label>
                              <Form.Control>
                                <Input type="number" min={1} {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                      </div>
                    </div>
                  ))
                )}

                <datalist id="partners-list">
                  {(partners || []).map((p: any) => (
                    <option key={String(p.id)} value={String(p.id)} />
                  ))}
                </datalist>
              </div>
            </Container>

            <Container className="divide-y p-0">
              <div className="px-6 py-4">
                <Heading level="h2">Send to production (optional)</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  If enabled, we will call send-to-production after creating the run.
                </Text>
              </div>

              <div className="px-6 py-4">
                <Form.Field
                  control={form.control}
                  name="send_to_production"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Send immediately</Form.Label>
                      <Form.Control>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!field.value}
                            onCheckedChange={field.onChange}
                          />
                          <Text size="small" className="text-ui-fg-subtle">
                            Enable send to production
                          </Text>
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {sendToProduction && (
                  <div className="mt-4">
                    <Text size="small" className="text-ui-fg-subtle">
                      Select task templates (names) to create for the run.
                    </Text>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {templatesToShow.map((tpl: any) => {
                        const name = String(tpl.name)
                        const selected = selectedTemplateNames.includes(name)
                        return (
                          <button
                            key={name}
                            type="button"
                            className="rounded-md border px-2 py-1 text-xs"
                            onClick={() => {
                              const current = form.getValues("template_names") || []
                              const next = selected
                                ? current.filter((n) => n !== name)
                                : [...current, name]
                              form.setValue("template_names", next, {
                                shouldDirty: true,
                              })
                            }}
                          >
                            <Badge color={selected ? "green" : "grey"}>{name}</Badge>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Container>
          </div>
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button
              size="small"
              type="submit"
              isLoading={isCreating || sendMutation.isPending}
            >
              Create
            </Button>
          </div>
        </RouteDrawer.Footer>
      </form>
    </RouteDrawer.Form>
  )
}

export default function CreateProductionRunDrawer() {
  return (
    <RouteDrawer>
      <CreateProductionRunDrawerForm />
    </RouteDrawer>
  )
}
