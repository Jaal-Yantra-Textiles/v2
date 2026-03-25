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
import { useCallback, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { z } from "@medusajs/framework/zod"

import { Form } from "../../../../components/common/form"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { StackedFocusModal } from "../../../../components/modal/stacked-modal/stacked-focused-modal"
import { useStackedModal } from "../../../../components/modal/stacked-modal/use-stacked-modal"

import { usePartners } from "../../../../hooks/api/partners"
import { useTaskTemplates } from "../../../../hooks/api/task-templates"
import { useTaskTemplateCategories } from "../../../../hooks/api/task-template-categories"
import {
  useCreateDesignProductionRun,
  useSendProductionRunToProduction,
} from "../../../../hooks/api/production-runs"

const assignmentSchema = z.object({
  partner_id: z.string().min(1, "Partner is required"),
  role: z.string().optional(),
  quantity: z.coerce.number().positive("Quantity must be > 0"),
  order: z.coerce.number().int().positive().optional(),
  template_names: z.array(z.string()).optional(),
})

const createSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  assignments: z.array(assignmentSchema).optional(),
  send_to_production: z.boolean().optional(),
  template_names: z.array(z.string()).optional(),
})

type FormValues = z.infer<typeof createSchema>

type Assignment = {
  partner_id: string
  role?: string
  quantity: number
  order?: number
  template_names?: string[]
}

const MODAL_ID = "manage-assignments"

const AssignmentsModal = ({
  form,
  partners,
  templatesToShow,
}: {
  form: any
  partners: any[]
  templatesToShow: any[]
}) => {
  const { setIsOpen } = useStackedModal()
  const [local, setLocal] = useState<Assignment[]>([])

  const currentAssignments: Assignment[] = form.watch("assignments") || []

  const handleOpen = useCallback(() => {
    setLocal(
      (form.getValues("assignments") || []).map((a: Assignment) => ({ ...a }))
    )
  }, [form])

  const handleSave = useCallback(() => {
    form.setValue("assignments", local, { shouldDirty: true })
    setIsOpen(MODAL_ID, false)
  }, [form, local, setIsOpen])

  const addAssignment = () => {
    setLocal((prev) => [
      ...prev,
      { partner_id: "", role: "", quantity: 1, order: undefined, template_names: [] },
    ])
  }

  const removeAssignment = (idx: number) => {
    setLocal((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateField = (idx: number, field: string, value: any) => {
    setLocal((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a))
    )
  }

  const toggleTemplate = (idx: number, name: string) => {
    setLocal((prev) =>
      prev.map((a, i) => {
        if (i !== idx) return a
        const current = a.template_names || []
        const next = current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name]
        return { ...a, template_names: next }
      })
    )
  }

  const partnerName = (id: string) => {
    const p = partners.find((p: any) => String(p.id) === id)
    return p ? String(p.name || p.handle || p.id) : id
  }

  return (
    <StackedFocusModal id={MODAL_ID}>
      <StackedFocusModal.Trigger asChild>
        <Button type="button" size="small" variant="secondary" onClick={handleOpen}>
          Manage Assignments{currentAssignments.length > 0 ? ` (${currentAssignments.length})` : ""}
        </Button>
      </StackedFocusModal.Trigger>

      <StackedFocusModal.Content className="flex flex-col">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Assignments</StackedFocusModal.Title>
          <StackedFocusModal.Description>
            Add partner assignments with ordering and task templates.
          </StackedFocusModal.Description>
        </StackedFocusModal.Header>

        <StackedFocusModal.Body className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col gap-y-4">
            {local.map((assignment, idx) => (
              <div key={idx} className="rounded-lg border p-4">
                <div className="flex items-center justify-between mb-4">
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

                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div>
                    <Text size="small" weight="plus" className="mb-1">Partner</Text>
                    <Select
                      value={assignment.partner_id || ""}
                      onValueChange={(v) => updateField(idx, "partner_id", v)}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select partner" />
                      </Select.Trigger>
                      <Select.Content>
                        {partners.map((p: any) => (
                          <Select.Item key={String(p.id)} value={String(p.id)}>
                            {String(p.name || p.handle || p.id)}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>

                  <div>
                    <Text size="small" weight="plus" className="mb-1">Role</Text>
                    <Input
                      placeholder="e.g. cutter"
                      value={assignment.role || ""}
                      onChange={(e) => updateField(idx, "role", e.target.value)}
                    />
                  </div>

                  <div>
                    <Text size="small" weight="plus" className="mb-1">Quantity</Text>
                    <Input
                      type="number"
                      min={1}
                      value={assignment.quantity ?? ""}
                      onChange={(e) =>
                        updateField(idx, "quantity", e.target.value ? Number(e.target.value) : "")
                      }
                    />
                  </div>

                  <div>
                    <Text size="small" weight="plus" className="mb-1">Order</Text>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Execution order"
                      value={assignment.order ?? ""}
                      onChange={(e) =>
                        updateField(
                          idx,
                          "order",
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <Text size="small" weight="plus" className="mb-2">
                    Task Templates
                  </Text>
                  {Object.entries(
                    templatesToShow.reduce((acc: Record<string, any[]>, tpl: any) => {
                      const cat = typeof tpl.category === "object"
                        ? tpl.category?.name || "Uncategorized"
                        : String(tpl.category || "Uncategorized")
                      if (!acc[cat]) acc[cat] = []
                      acc[cat].push(tpl)
                      return acc
                    }, {} as Record<string, any[]>)
                  ).map(([categoryName, categoryTemplates]) => {
                    const categoryNames = categoryTemplates.map((t: any) => String(t.name))
                    const selectedNames = assignment.template_names || []
                    const allSelected = categoryNames.every((n: string) => selectedNames.includes(n))

                    return (
                      <div key={categoryName} className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                            {categoryName}
                          </Text>
                          <button
                            type="button"
                            className="text-xs text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                            onClick={() => {
                              if (allSelected) {
                                // Deselect all in this category
                                const next = selectedNames.filter((n: string) => !categoryNames.includes(n))
                                updateField(idx, "template_names", next)
                              } else {
                                // Select all in this category
                                const next = [...new Set([...selectedNames, ...categoryNames])]
                                updateField(idx, "template_names", next)
                              }
                            }}
                          >
                            {allSelected ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {categoryTemplates.map((tpl: any) => {
                            const name = String(tpl.name)
                            const selected = selectedNames.includes(name)
                            return (
                              <button
                                key={name}
                                type="button"
                                className="rounded-md border px-3 py-1.5 text-sm"
                                onClick={() => toggleTemplate(idx, name)}
                              >
                                <Badge color={selected ? "green" : "grey"}>{name}</Badge>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={addAssignment}
              className="self-start"
            >
              + Add Assignment
            </Button>
          </div>
        </StackedFocusModal.Body>

        <StackedFocusModal.Footer>
          <StackedFocusModal.Close asChild>
            <Button size="small" variant="secondary" type="button">
              Cancel
            </Button>
          </StackedFocusModal.Close>
          <Button size="small" type="button" onClick={handleSave}>
            Save Assignments
          </Button>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}

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
  const assignments = form.watch("assignments") || []

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

  const partnerName = (id: string) => {
    const p = partners.find((p: any) => String(p.id) === id)
    return p ? String(p.name || p.handle || p.id) : id
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!designId) {
      toast.error("Missing design id")
      return
    }

    const hasPerAssignmentTemplates = values.assignments?.some(
      (a) => a.template_names && a.template_names.length > 0
    )

    if (
      values.send_to_production &&
      !hasPerAssignmentTemplates &&
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
                <AssignmentsModal
                  form={form}
                  partners={partners}
                  templatesToShow={templatesToShow}
                />
              </div>

              {assignments.length > 0 && (
                <div className="px-6 py-3">
                  <Text size="small" className="text-ui-fg-subtle">
                    {assignments.length} assignment{assignments.length > 1 ? "s" : ""} —{" "}
                    {assignments
                      .map((a: any) =>
                        a.partner_id ? partnerName(a.partner_id) : "Unassigned"
                      )
                      .join(", ")}
                  </Text>
                </div>
              )}
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
                      Select task templates by category to create for the run.
                    </Text>

                    <div className="mt-2">
                      {Object.entries(
                        templatesToShow.reduce((acc: Record<string, any[]>, tpl: any) => {
                          const cat = typeof tpl.category === "object"
                            ? tpl.category?.name || "Uncategorized"
                            : String(tpl.category || "Uncategorized")
                          if (!acc[cat]) acc[cat] = []
                          acc[cat].push(tpl)
                          return acc
                        }, {} as Record<string, any[]>)
                      ).map(([categoryName, categoryTemplates]) => {
                        const categoryNames = categoryTemplates.map((t: any) => String(t.name))
                        const allSelected = categoryNames.every((n: string) => selectedTemplateNames.includes(n))

                        return (
                          <div key={categoryName} className="mb-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                                {categoryName}
                              </Text>
                              <button
                                type="button"
                                className="text-xs text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                                onClick={() => {
                                  const current = form.getValues("template_names") || []
                                  if (allSelected) {
                                    form.setValue(
                                      "template_names",
                                      current.filter((n) => !categoryNames.includes(n)),
                                      { shouldDirty: true }
                                    )
                                  } else {
                                    form.setValue(
                                      "template_names",
                                      [...new Set([...current, ...categoryNames])],
                                      { shouldDirty: true }
                                    )
                                  }
                                }}
                              >
                                {allSelected ? "Deselect all" : "Select all"}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {categoryTemplates.map((tpl: any) => {
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
