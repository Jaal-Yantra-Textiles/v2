import { zodResolver } from "@hookform/resolvers/zod"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useCallback, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { z } from "@medusajs/framework/zod"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { StackedFocusModal } from "../../../../components/modal/stacked-modal/stacked-focused-modal"
import { useStackedModal } from "../../../../components/modal/stacked-modal/use-stacked-modal"

import { usePartners } from "../../../../hooks/api/partners"
import { useTaskTemplates } from "../../../../hooks/api/task-templates"
import { useApproveProductionRun, useProductionRun } from "../../../../hooks/api/production-runs"
import { useDesignInventory } from "../../../../hooks/api/designs"
import {
  cleanAssignmentMaterialsForSave,
  type DraftMaterial,
} from "../../../../components/forms/production-run/clean-assignment-materials"

const assignmentSchema = z.object({
  partner_id: z.string().min(1, "Partner is required"),
  role: z.string().optional(),
  quantity: z.coerce.number().positive("Quantity must be > 0"),
  order: z.coerce.number().int().positive().optional(),
  template_names: z.array(z.string()).optional(),
  template_ids: z.array(z.string()).optional(),
  /**
   * Draft rows for the material picker — every BOM item, selected or not. They
   * are cleaned into the API's `materials` on submit; an unselected row is
   * noise and never leaves the form (#1361).
   */
  materials_draft: z.array(z.any()).optional(),
})

const approveSchema = z.object({
  assignments: z.array(assignmentSchema).optional(),
})

type FormValues = z.infer<typeof approveSchema>

type Assignment = {
  partner_id: string
  role?: string
  quantity: number
  order?: number
  template_names?: string[]
  template_ids?: string[]
  materials_draft?: DraftMaterial[]
}

const MODAL_ID = "approve-assignments"

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
  bomItems: Array<{ id: string; label: string; planned_quantity?: number | null }>
}) => {
  const { setIsOpen } = useStackedModal()
  const [local, setLocal] = useState<Assignment[]>([])

  /** Names more than one template answers to — these must show their category. */
  const ambiguousNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of templatesToShow || []) {
      const name = String((t as any)?.name || "")
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name)
    )
  }, [templatesToShow])

  const currentAssignments: Assignment[] = form.watch("assignments") || []

  const handleOpen = useCallback(() => {
    setLocal(
      (form.getValues("assignments") || []).map((a: Assignment) => ({ ...a }))
    )
  }, [form])

  const handleSave = useCallback(() => {
    // Catch a bad quantity HERE, in the modal where the field is, rather than
    // letting it surface as a zod path after the drawer has been submitted.
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

  /**
   * Keyed by id, not name (#1268). Two templates can share a name — different
   * process steps wearing one label (#1261) — so a name-keyed toggle merged
   * them into one control and then recorded an intent dispatch REFUSES, leaving
   * the run approved and undispatchable.
   */
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
   * The material picker. Every BOM item is a row; `selected` is what makes it
   * part of THIS assignment. Rows are kept even when unselected so a quantity
   * typed, deselected and reselected is not lost mid-edit — and dropped on save
   * by `cleanAssignmentMaterialsForSave`, never sent as a blank.
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
                  <div className="flex flex-wrap gap-2">
                    {templatesToShow.map((tpl: any) => {
                      const id = String(tpl.id)
                      const name = String(tpl.name)
                      const selected = (assignment.template_ids || []).includes(id)
                      // Without the category these are indistinguishable, and
                      // they are different process steps (#1261).
                      const label = ambiguousNames.has(name)
                        ? `${name} — ${tpl.category?.name || "uncategorised"}`
                        : name
                      return (
                        <button
                          key={id}
                          type="button"
                          className="rounded-md border px-3 py-1.5 text-sm"
                          onClick={() => toggleTemplate(idx, id)}
                        >
                          <Badge color={selected ? "green" : "grey"}>{label}</Badge>
                        </button>
                      )
                    })}
                  </div>
                </div>

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
                                value={String(row.planned_quantity ?? "")}
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

const ApproveProductionRunDrawerForm = () => {
  const { id: runId } = useParams()
  const { handleSuccess } = useRouteModal()

  const form = useForm<FormValues>({
    resolver: zodResolver(approveSchema),
    defaultValues: {
      assignments: [],
    },
  })

  const assignments = form.watch("assignments") || []

  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const { task_templates: taskTemplates = [] } = useTaskTemplates({ limit: 100, offset: 0 })

  // The design's bill of materials — what an assignment's selection is a subset
  // OF. A run with no design (the #1112 product-only path) simply has none, and
  // the picker does not render.
  const { production_run } = useProductionRun(runId || "", undefined, {
    enabled: !!runId,
  } as any)
  const designId = (production_run as any)?.design_id || ""
  const { data: designInventory } = useDesignInventory(designId, {
    enabled: !!designId,
  })

  const bomItems = useMemo(
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

  const templatesToShow = useMemo(() => {
    return [...(taskTemplates || [])].sort((a: any, b: any) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    )
  }, [taskTemplates])

  const { mutateAsync: approveRun, isPending } = useApproveProductionRun(runId || "")

  const partnerName = (id: string) => {
    const p = partners.find((p: any) => String(p.id) === id)
    return p ? String(p.name || p.handle || p.id) : id
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!runId) {
      toast.error("Missing run id")
      return
    }

    // Build the API payload: the picker's draft rows become `materials`, and
    // `materials_draft` — a form-only field — never leaves the browser.
    let payload: any[] | undefined
    if (values.assignments?.length) {
      payload = []
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
        payload.push({
          ...rest,
          ...(cleaned.materials.length ? { materials: cleaned.materials } : {}),
        })
      }
    }

    try {
      await approveRun({
        assignments: payload,
      })
      toast.success("Production run approved")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve")
    }
  })

  return (
    <RouteDrawer.Form form={form}>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteDrawer.Header>
          <Heading>Approve Production Run</Heading>
        </RouteDrawer.Header>

        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto py-6">
          <div className="flex flex-col gap-y-6">
            <Container className="divide-y p-0">
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <Heading level="h2">Assignments</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Optional. Add partner assignments with ordering and templates.
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
          </div>
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Approve
            </Button>
          </div>
        </RouteDrawer.Footer>
      </form>
    </RouteDrawer.Form>
  )
}

export default function ApproveProductionRunDrawer() {
  return (
    <RouteDrawer>
      <ApproveProductionRunDrawerForm />
    </RouteDrawer>
  )
}
