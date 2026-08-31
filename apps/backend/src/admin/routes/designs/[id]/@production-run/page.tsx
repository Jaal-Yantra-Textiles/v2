import { zodResolver } from "@hookform/resolvers/zod"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { ExclamationCircle } from "@medusajs/icons"
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
import { useDesignInventory } from "../../../../hooks/api/designs"
import {
  cleanAssignmentMaterialsForSave,
  type DraftMaterial,
} from "../../../../components/forms/production-run/clean-assignment-materials"
import {
  useCreateDesignProductionRun,
  useSendProductionRunToProduction,
} from "../../../../hooks/api/production-runs"

const assignmentSchema = z.object({
  partner_id: z.string().min(1, "Partner is required"),
  role: z.string().optional(),
  /**
   * Units for this partner's child run.
   *
   * 🔴 `null` is a DECLARATION (#1676): this run has no agreed quantity —
   * open-ended, ongoing work — and payouts against it are not capped at an
   * agreed amount. `.nullable()` sits outside the coercion on purpose: coercing
   * null would make it 0, which is a broken number rather than a statement.
   */
  quantity: z.coerce.number().positive("Quantity must be > 0").nullable(),
  order: z.coerce.number().int().positive().optional(),
  template_names: z.array(z.string()).optional(),
  template_ids: z.array(z.string()).optional(),
  /**
   * Form-only. The picker's rows, including the ones toggled off, so a
   * quantity typed and then deselected survives a mid-edit change of mind.
   * Cleaned into the API's `materials` on submit; this key never leaves the
   * browser. `z.any()` because the cleaner owns the shape and validates it in
   * words — a zod path here would only restate it worse.
   */
  materials_draft: z.array(z.any()).optional(),
})

const createSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  assignments: z.array(assignmentSchema).optional(),
  send_to_production: z.boolean().optional(),
  template_names: z.array(z.string()).optional(),
  template_ids: z.array(z.string()).optional(),
})

type FormValues = z.infer<typeof createSchema>

type Assignment = {
  partner_id: string
  role?: string
  /** `null` = no agreed quantity, an open-ended run (#1676). */
  quantity: number | null
  order?: number
  template_names?: string[]
  template_ids?: string[]
  materials_draft?: DraftMaterial[]
}

/** One row of the design's bill of materials, as the picker needs it. */
type BomItem = {
  id: string
  label: string
  planned_quantity?: number | null
}

/**
 * Two templates can share a name — different process steps wearing one label
 * (#1261) — and dispatch REFUSES an ambiguous name since #1262. Selection is
 * therefore keyed by id everywhere below; the grouping by category already
 * separates the common collision visually, so a name is only qualified further
 * when it repeats INSIDE one category, where the header cannot tell them apart.
 */
const labelForTemplate = (tpl: any, siblingNameCount: number) => {
  const name = String(tpl?.name || "")
  return siblingNameCount > 1 ? `${name} · ${String(tpl?.id || "").slice(-6)}` : name
}

/** Group templates by category name, preserving the existing display order. */
const groupByCategory = (templates: any[]): [string, any[]][] =>
  Object.entries(
    templates.reduce((acc: Record<string, any[]>, tpl: any) => {
      const cat =
        typeof tpl.category === "object"
          ? tpl.category?.name || "Uncategorized"
          : String(tpl.category || "Uncategorized")
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(tpl)
      return acc
    }, {} as Record<string, any[]>)
  )

/** How many templates in `group` answer to each name — drives the label above. */
const nameCounts = (group: any[]) => {
  const counts = new Map<string, number>()
  for (const t of group) {
    const name = String(t?.name || "")
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

const MODAL_ID = "manage-assignments"

const AssignmentsModal = ({
  form,
  partners,
  templatesToShow,
  bomItems,
}: {
  form: any
  partners: any[]
  templatesToShow: any[]
  /** The design's bill of materials — what an assignment may be a subset OF. */
  bomItems: BomItem[]
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
    // Catch a bad quantity HERE, in the modal where the field is. The drawer
    // closes on save, so a complaint raised later — after submit — names a
    // field the operator can no longer see.
    for (const [i, a] of local.entries()) {
      const cleaned = cleanAssignmentMaterialsForSave(
        a.materials_draft,
        (id) => bomItems.find((b) => b.id === id)?.label || id
      )
      if (!cleaned.ok) {
        toast.error(`Assignment ${i + 1}: ${cleaned.error}`)
        return
      }
    }
    form.setValue("assignments", local, { shouldDirty: true })
    setIsOpen(MODAL_ID, false)
  }, [form, local, setIsOpen, bomItems])

  const addAssignment = () => {
    setLocal((prev) => [
      ...prev,
      {
        partner_id: "",
        role: "",
        quantity: 1,
        order: undefined,
        template_ids: [],
        materials_draft: [],
      },
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

  /** Keyed by id, not name — see `labelForTemplate` (#1272). */
  const toggleTemplate = (idx: number, id: string) => {
    setLocal((prev) =>
      prev.map((a, i) => {
        if (i !== idx) return a
        const current = a.template_ids || []
        const next = current.includes(id)
          ? current.filter((t) => t !== id)
          : [...current, id]
        return { ...a, template_ids: next }
      })
    )
  }

  /**
   * The material picker's rows. EVERY BOM item is a row; `selected` is what
   * makes it part of this assignment. Unselected rows are kept rather than
   * removed so a quantity typed, deselected and reselected is not lost — and
   * dropped on save by `cleanAssignmentMaterialsForSave`, never sent blank.
   */
  const materialDraft = (a: Assignment): DraftMaterial[] => {
    const byId = new Map(
      (a.materials_draft || []).map((d) => [d.inventory_item_id, d])
    )
    return bomItems.map(
      (item) =>
        byId.get(item.id) || {
          inventory_item_id: item.id,
          selected: false,
          planned_quantity: "",
        }
    )
  }

  const updateMaterial = (
    idx: number,
    inventoryItemId: string,
    patch: Partial<DraftMaterial>
  ) => {
    setLocal((prev) =>
      prev.map((a, i) => {
        if (i !== idx) return a
        const rows = materialDraft(a).map((row) =>
          row.inventory_item_id === inventoryItemId ? { ...row, ...patch } : row
        )
        return { ...a, materials_draft: rows }
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
                    {assignment.partner_id &&
                      partners.find(
                        (p: any) => String(p.id) === assignment.partner_id
                      )?.has_whatsapp_contact === false && (
                        <div className="mt-1 flex items-start gap-x-1 text-ui-tag-orange-text">
                          <ExclamationCircle className="mt-0.5 shrink-0" />
                          <Text size="xsmall">
                            No WhatsApp contact — production updates won't reach
                            this partner directly. Add a verified WhatsApp number
                            or an active admin phone on the partner.
                          </Text>
                        </div>
                      )}
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
                      disabled={assignment.quantity === null}
                      value={
                        assignment.quantity === null
                          ? ""
                          : (assignment.quantity ?? "")
                      }
                      onChange={(e) =>
                        updateField(idx, "quantity", e.target.value ? Number(e.target.value) : "")
                      }
                    />
                    <div className="mt-2 flex items-center gap-x-2">
                      {/* #1676 — a run with NO agreed quantity is deliberately
                        * open-ended, and payouts against it are not capped at
                        * an agreed amount. A switch rather than an empty box:
                        * an empty box is somebody who has not typed yet. */}
                      <Switch
                        id={`assignment-open-ended-${idx}`}
                        checked={assignment.quantity === null}
                        onCheckedChange={(checked) =>
                          updateField(idx, "quantity", checked ? null : 1)
                        }
                      />
                      <Label size="xsmall" htmlFor={`assignment-open-ended-${idx}`}>
                        No agreed quantity (open-ended) — payouts uncapped
                      </Label>
                    </div>
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
                  {groupByCategory(templatesToShow).map(
                    ([categoryName, categoryTemplates]) => {
                    const categoryIds = categoryTemplates.map((t: any) => String(t.id))
                    const selectedIds = assignment.template_ids || []
                    const allSelected = categoryIds.every((id: string) => selectedIds.includes(id))
                    const counts = nameCounts(categoryTemplates)

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
                                const next = selectedIds.filter((id: string) => !categoryIds.includes(id))
                                updateField(idx, "template_ids", next)
                              } else {
                                // Select all in this category
                                const next = [...new Set([...selectedIds, ...categoryIds])]
                                updateField(idx, "template_ids", next)
                              }
                            }}
                          >
                            {allSelected ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {categoryTemplates.map((tpl: any) => {
                            const id = String(tpl.id)
                            const selected = selectedIds.includes(id)
                            return (
                              <button
                                key={id}
                                type="button"
                                className="rounded-md border px-3 py-1.5 text-sm"
                                onClick={() => toggleTemplate(idx, id)}
                              >
                                <Badge color={selected ? "green" : "grey"}>
                                  {labelForTemplate(tpl, counts.get(String(tpl.name)) ?? 1)}
                                </Badge>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Which of the design's inventory items THIS partner is sent.
                    The API has taken `materials` per assignment since #1361 and
                    the approve drawer has offered it since; creating the run
                    from the design — the path most runs are actually born on —
                    could not, so a chain that splits the BOM between a dyer and
                    a weaver had to be approved first and edited after. */}
                {bomItems.length > 0 && (
                  <div className="mt-4">
                    <Text size="small" weight="plus" className="mb-1">
                      Materials for this partner
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle mb-2">
                      Select which of the design&apos;s inventory items THIS
                      partner is sent. Select none and they get the whole bill of
                      materials, as before. Once you select any, they cannot log
                      consumption against anything else.
                    </Text>
                    <div className="flex flex-col gap-2">
                      {materialDraft(assignment).map((row) => {
                        const item = bomItems.find(
                          (b) => b.id === row.inventory_item_id
                        )
                        return (
                          <div
                            key={row.inventory_item_id}
                            className="flex items-center gap-x-3"
                          >
                            <button
                              type="button"
                              className="rounded-md border px-3 py-1.5 text-sm"
                              onClick={() =>
                                updateMaterial(idx, row.inventory_item_id, {
                                  selected: !row.selected,
                                })
                              }
                            >
                              <Badge color={row.selected ? "green" : "grey"}>
                                {item?.label || row.inventory_item_id}
                              </Badge>
                            </button>
                            {row.selected && (
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                className="max-w-[10rem]"
                                placeholder={
                                  item?.planned_quantity != null
                                    ? `Design plans ${item.planned_quantity}`
                                    : "Qty (optional)"
                                }
                                value={
                                  row.planned_quantity === null ||
                                  row.planned_quantity === undefined
                                    ? ""
                                    : String(row.planned_quantity)
                                }
                                onChange={(e) =>
                                  updateMaterial(idx, row.inventory_item_id, {
                                    planned_quantity: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
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
      run_type: "production",
      assignments: [],
      send_to_production: false,
      template_ids: [],
    },
  })

  const sendToProduction = form.watch("send_to_production")
  const selectedTemplateIds = form.watch("template_ids") || []
  const assignments = form.watch("assignments") || []

  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const { task_templates: taskTemplates = [] } = useTaskTemplates({ limit: 100, offset: 0 })

  const templatesToShow = useMemo(() => {
    return [...(taskTemplates || [])].sort((a: any, b: any) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    )
  }, [taskTemplates])

  // The design's bill of materials — what an assignment's selection is a subset
  // OF. A design with no inventory attached simply has none and the picker does
  // not render, which is why this is not gated on anything else.
  const { data: designInventory } = useDesignInventory(designId || "", {
    enabled: !!designId,
  })

  const bomItems: BomItem[] = useMemo(
    () =>
      (designInventory?.inventory_items || []).map((row: any) => ({
        id: row.inventory_item_id,
        label:
          row.inventory_item?.title ||
          row.inventory_item?.sku ||
          row.inventory_item_id,
        planned_quantity: row.planned_quantity ?? null,
      })),
    [designInventory]
  )

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
      (a) => a.template_ids && a.template_ids.length > 0
    )

    if (
      values.send_to_production &&
      !hasPerAssignmentTemplates &&
      (!values.template_ids || !values.template_ids.length)
    ) {
      toast.error("Select at least one task template")
      return
    }

    // The picker's draft rows become the API's `materials`; `materials_draft`
    // is a form-only field and must never leave the browser — the assignment
    // validator is strict, so an unrecognised key is a 400, not a shrug.
    let assignmentsPayload: any[] | undefined
    if (values.assignments?.length) {
      assignmentsPayload = []
      for (const [i, a] of (values.assignments as Assignment[]).entries()) {
        const cleaned = cleanAssignmentMaterialsForSave(
          a.materials_draft,
          (id) => bomItems.find((b) => b.id === id)?.label || id
        )
        if (!cleaned.ok) {
          toast.error(`Assignment ${i + 1}: ${cleaned.error}`)
          return
        }
        const { materials_draft: _drop, ...rest } = a
        assignmentsPayload.push({
          ...rest,
          ...(cleaned.materials.length ? { materials: cleaned.materials } : {}),
        })
      }
    }

    try {
      const res = await createRun({
        quantity: values.quantity,
        run_type: values.run_type || "production",
        assignments: assignmentsPayload,
      })

      toast.success("Production run created")

      if (!values.send_to_production) {
        handleSuccess()
        return
      }

      // When per-assignment template_ids are set, the backend route
      // already auto-dispatches each child (see
      // apps/backend/src/api/admin/designs/[id]/production-runs/route.ts
      // — `autoDispatchApprovedChildren` over the approved children).
      // Calling sendMutation here would be a redundant second dispatch,
      // and with `values.template_ids = []` (global empty because the
      // user picked per-assignment templates) the strict `min(1)`
      // validator on /send-to-production would 400.
      if (hasPerAssignmentTemplates) {
        toast.success("Sent to production")
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
          // By id — dispatch refuses an ambiguous name (#1262/#1272).
          template_ids: values.template_ids || [],
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
                <Heading level="h2">Run Details</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Set the type and quantity for this production run.
                </Text>
              </div>

              <div className="px-6 py-4 grid grid-cols-2 gap-4">
                <Form.Field
                  control={form.control}
                  name="run_type"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Type</Form.Label>
                      <Form.Control>
                        <Select
                          value={field.value || "production"}
                          onValueChange={field.onChange}
                        >
                          <Select.Trigger>
                            <Select.Value />
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
                  bomItems={bomItems}
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
                      {groupByCategory(templatesToShow).map(
                        ([categoryName, categoryTemplates]) => {
                        const categoryIds = categoryTemplates.map((t: any) => String(t.id))
                        const allSelected = categoryIds.every((id: string) => selectedTemplateIds.includes(id))
                        const counts = nameCounts(categoryTemplates)

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
                                  const current = form.getValues("template_ids") || []
                                  if (allSelected) {
                                    form.setValue(
                                      "template_ids",
                                      current.filter((id) => !categoryIds.includes(id)),
                                      { shouldDirty: true }
                                    )
                                  } else {
                                    form.setValue(
                                      "template_ids",
                                      [...new Set([...current, ...categoryIds])],
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
                                const id = String(tpl.id)
                                const selected = selectedTemplateIds.includes(id)
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    className="rounded-md border px-2 py-1 text-xs"
                                    onClick={() => {
                                      const current = form.getValues("template_ids") || []
                                      const next = selected
                                        ? current.filter((t) => t !== id)
                                        : [...current, id]
                                      form.setValue("template_ids", next, {
                                        shouldDirty: true,
                                      })
                                    }}
                                  >
                                    <Badge color={selected ? "green" : "grey"}>
                                      {labelForTemplate(tpl, counts.get(String(tpl.name)) ?? 1)}
                                    </Badge>
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
