import {
  Badge,
  Button,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useTaskTemplates } from "../../../../hooks/api/task-templates"
import {
  useProductionRun,
  useStartDispatch,
  useResumeDispatch,
} from "../../../../hooks/api/production-runs"

type DispatchStep = "select-templates" | "dispatching" | "done"

const DispatchProductionRunDrawerForm = () => {
  const { id: runId } = useParams()
  const { handleSuccess } = useRouteModal()

  const { production_run: run } = useProductionRun(runId || "", undefined, {
    enabled: !!runId,
  })

  const { task_templates: taskTemplates = [] } = useTaskTemplates({
    limit: 100,
    offset: 0,
  })

  const templatesToShow = useMemo(() => {
    return [...(taskTemplates || [])].sort((a: any, b: any) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    )
  }, [taskTemplates])

  /**
   * Names that more than one template answers to. Prod carries two "Stitching"
   * rows differing only by category — different process steps wearing one label
   * (#1261). Dispatch refuses such a name, so the picker has to show the
   * category or the choice cannot be made here at all.
   */
  const ambiguousNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of templatesToShow) {
      const name = String((t as any)?.name || "")
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name)
    )
  }, [templatesToShow])

  /**
   * Selection is by ID, not name. Keying it by name merged the two "Stitching"
   * rows into one toggle and then sent a name dispatch rejects.
   */
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([])
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const [step, setStep] = useState<DispatchStep>("select-templates")

  /**
   * Preselect what this run was last dispatched with (#1265) — the record
   * written BY dispatch. `dispatch_template_names` is only approval-time intent
   * and is null on most runs, so it is the fallback, and only for names that
   * identify exactly one template.
   */
  useEffect(() => {
    if (!run?.id || seededFrom === run.id || !templatesToShow.length) {
      return
    }

    const knownIds = new Set(templatesToShow.map((t: any) => String(t.id)))
    const dispatched = ((run as any)?.dispatched_template_ids as string[] | null) || []
    const seed = dispatched.filter((id) => knownIds.has(String(id)))

    if (!seed.length) {
      const intent = ((run as any)?.dispatch_template_names as string[] | null) || []
      for (const name of intent) {
        if (ambiguousNames.has(String(name))) {
          continue
        }
        const match = templatesToShow.find(
          (t: any) => String(t.name) === String(name)
        )
        if (match) {
          seed.push(String((match as any).id))
        }
      }
    }

    setSeededFrom(run.id)
    if (seed.length) {
      setSelectedTemplates(seed)
    }
  }, [run?.id, templatesToShow, ambiguousNames, seededFrom])

  const startDispatch = useStartDispatch(runId || "")
  const resumeDispatch = useResumeDispatch(runId || "")

  const isPending = startDispatch.isPending || resumeDispatch.isPending

  /** The summary line reads names, not the ids the selection is keyed on. */
  const selectedLabels = useMemo(() => {
    return selectedTemplates.map((id) => {
      const tpl: any = templatesToShow.find((t: any) => String(t.id) === id)
      if (!tpl) {
        return id
      }
      const name = String(tpl.name)
      return ambiguousNames.has(name)
        ? `${name} (${tpl.category?.name || "uncategorised"})`
        : name
    })
  }, [selectedTemplates, templatesToShow, ambiguousNames])

  const toggleTemplate = (id: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  const handleDispatch = async () => {
    if (!runId) return

    if (selectedTemplates.length === 0) {
      toast.error("Select at least one task template")
      return
    }

    try {
      setStep("dispatching")

      // Step 1: Start the dispatch workflow (returns transaction_id)
      const { transaction_id } = await startDispatch.mutateAsync()

      // Step 2: Resume with selected templates
      // Ids, not names — the selection already knows exactly which rows.
      await resumeDispatch.mutateAsync({
        transaction_id,
        template_ids: selectedTemplates,
      })

      setStep("done")
      toast.success("Production run dispatched to partner")
      handleSuccess()
    } catch (e: any) {
      setStep("select-templates")
      const msg = e?.message || e?.body?.message || "Failed to dispatch"
      toast.error(msg)
    }
  }

  // Check if dispatch is valid
  const status = run?.status
  const canDispatch = status === "approved" || status === "sent_to_partner"
  const isAlreadyDispatched = status === "sent_to_partner" || status === "in_progress"

  // Check for unmet dependencies
  const hasDeps = (run?.depends_on_run_ids as string[] | null)?.length
  const depsWarning = hasDeps
    ? "This run has dependencies. Dispatch will fail if dependencies are not completed."
    : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
          <Heading>Dispatch Production Run</Heading>
        </RouteDrawer.Header>

        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto py-6">
          {isAlreadyDispatched ? (
            <Container className="p-4">
              <Text className="text-ui-fg-subtle">
                This run has already been dispatched to the partner.
              </Text>
            </Container>
          ) : !canDispatch ? (
            <Container className="p-4">
              <Text className="text-ui-fg-subtle">
                Run must be in "approved" status to dispatch. Current status:{" "}
                <StatusBadge color="grey">{status?.replace(/_/g, " ")}</StatusBadge>
              </Text>
            </Container>
          ) : (
            <>
              {/* Run info */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">Run Details</Heading>
                </div>
                <div className="px-6 py-3 grid grid-cols-2 gap-3">
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Design</Text>
                    <Text size="small">
                      {run?.snapshot?.design?.name || run?.design_id || "-"}
                    </Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Partner</Text>
                    <Text size="small">
                      {run?.snapshot?.provenance?.partner_name || run?.partner_id || "-"}
                    </Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Quantity</Text>
                    <Text size="small">{String(run?.quantity ?? "-")}</Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Type</Text>
                    <Text size="small">
                      {run?.run_type === "sample" ? "Sample" : "Production"}
                    </Text>
                  </div>
                </div>
              </Container>

              {/* Dependencies warning */}
              {depsWarning && (
                <Container className="p-4 border-ui-tag-orange-border bg-ui-tag-orange-bg">
                  <Text size="small" className="text-ui-tag-orange-text">
                    {depsWarning}
                  </Text>
                </Container>
              )}

              {/* Template selection */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">Select Task Templates</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Choose which task templates to create for this production run.
                    The partner will see these as their work items.
                  </Text>
                </div>
                <div className="px-6 py-4">
                  {templatesToShow.length === 0 ? (
                    <Text size="small" className="text-ui-fg-subtle">
                      No task templates found. Create templates first.
                    </Text>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {templatesToShow.map((tpl: any) => {
                        const id = String(tpl.id)
                        const name = String(tpl.name)
                        const selected = selectedTemplates.includes(id)
                        const category = tpl.category?.name || null
                        const estCost = tpl.estimated_cost
                          ? ` (est. ${tpl.estimated_cost}${tpl.cost_currency ? ` ${tpl.cost_currency}` : ""})`
                          : ""
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                              selected
                                ? "border-ui-border-interactive bg-ui-bg-interactive"
                                : "border-ui-border-base hover:bg-ui-bg-base-hover"
                            }`}
                            onClick={() => toggleTemplate(id)}
                          >
                            <div className="flex flex-col">
                              <Text
                                size="small"
                                weight="plus"
                                className={selected ? "text-ui-fg-on-color" : ""}
                              >
                                {name}
                                {/* Without the category these two rows are
                                    indistinguishable, and they are different
                                    process steps (#1261). */}
                                {ambiguousNames.has(name) && (
                                  <span className="opacity-70">
                                    {" "}
                                    — {category || "uncategorised"}
                                  </span>
                                )}
                              </Text>
                              {tpl.description && (
                                <Text
                                  size="xsmall"
                                  className={
                                    selected
                                      ? "text-ui-fg-on-color opacity-80"
                                      : "text-ui-fg-subtle"
                                  }
                                >
                                  {String(tpl.description).slice(0, 80)}
                                  {estCost}
                                </Text>
                              )}
                            </div>
                            <Badge
                              color={selected ? "green" : "grey"}
                              size="2xsmall"
                            >
                              {selected ? "Selected" : ""}
                            </Badge>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {selectedTemplates.length > 0 && (
                  <div className="px-6 py-3">
                    <Text size="small" className="text-ui-fg-subtle">
                      {selectedTemplates.length} template{selectedTemplates.length > 1 ? "s" : ""} selected:{" "}
                      {selectedLabels.join(", ")}
                    </Text>
                  </div>
                )}
              </Container>
            </>
          )}
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                Cancel
              </Button>
            </RouteDrawer.Close>
            {canDispatch && !isAlreadyDispatched && (
              <Button
                size="small"
                type="button"
                onClick={handleDispatch}
                isLoading={isPending}
                disabled={selectedTemplates.length === 0}
              >
                {step === "dispatching"
                  ? "Dispatching..."
                  : `Dispatch${selectedTemplates.length > 0 ? ` (${selectedTemplates.length})` : ""}`}
              </Button>
            )}
          </div>
      </RouteDrawer.Footer>
    </div>
  )
}

export default function DispatchProductionRunDrawer() {
  return (
    <RouteDrawer>
      <DispatchProductionRunDrawerForm />
    </RouteDrawer>
  )
}
