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
import { useApproveProductionRun } from "../../../../hooks/api/production-runs"

const assignmentSchema = z.object({
  partner_id: z.string().min(1, "Partner is required"),
  role: z.string().optional(),
  quantity: z.coerce.number().positive("Quantity must be > 0"),
  order: z.coerce.number().int().positive().optional(),
  template_names: z.array(z.string()).optional(),
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
}

const MODAL_ID = "approve-assignments"

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
                      const name = String(tpl.name)
                      const selected = (assignment.template_names || []).includes(name)
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

    try {
      await approveRun({
        assignments: values.assignments?.length ? values.assignments : undefined,
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
