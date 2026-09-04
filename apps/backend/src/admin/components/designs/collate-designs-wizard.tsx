import { useState, useMemo, useEffect, useCallback } from "react"
import {
  Badge,
  Button,
  Checkbox,
  FocusModal,
  Heading,
  Input,
  Label,
  ProgressStatus,
  ProgressTabs,
  Text,
  Tooltip,
  toast,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { AdminDesign } from "../../hooks/api/designs"
import { usePartners, AdminPartner } from "../../hooks/api/partners"
import { useTaskTemplates } from "../../hooks/api/task-templates"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

/** Mirrors `ProduceDesignReport` on the workflow. */
interface ProduceDesignReport {
  design_id: string
  run_id: string | null
  template_ids: string[]
  dispatched: boolean
  quantity?: number
  reason?: string
}

interface ProduceDesignsResponse {
  design_production: {
    created: number
    run_ids: string[]
    design_ids: string[]
    work_order_id: string | null
    dry_run?: boolean
    designs?: ProduceDesignReport[]
    dispatched?: string[]
    not_dispatched?: ProduceDesignReport[]
    /** #1597 — whether the lines joined an existing work-order or minted one. */
    work_order_joined?: boolean
  }
}

/**
 * One design's plan. `template_ids: null` means "inherit the batch default" —
 * distinct from `[]`, which is a design the operator deliberately emptied and
 * which the API would create with no tasks for the partner to accept (#1263).
 */
interface DesignPlanRow {
  design_id: string
  name: string
  include: boolean
  quantity: number
  template_ids: string[] | null
}

enum Step {
  DESIGNS = "designs",
  PROCESS = "process",
  QUANTITIES = "quantities",
  COLLATION = "collation",
  REVIEW = "review",
}

const STEP_ORDER: Step[] = [
  Step.DESIGNS,
  Step.PROCESS,
  Step.QUANTITIES,
  Step.COLLATION,
  Step.REVIEW,
]

const STEP_LABEL: Record<Step, string> = {
  [Step.DESIGNS]: "Designs",
  [Step.PROCESS]: "Process",
  [Step.QUANTITIES]: "Quantities",
  [Step.COLLATION]: "Collation",
  [Step.REVIEW]: "Review",
}

/** The server's own default window, mirrored so the field is never blank. */
const DEFAULT_COLLATION_WINDOW_DAYS = 14

interface CollateDesignsWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

/**
 * #1803 — collating designs for a partner, as a stepped wizard.
 *
 * `POST /admin/designs/produce` has always accepted a per-design plan
 * (`designs[].template_ids`, `designs[].quantity`) and a `dry_run` preview.
 * The drawer this replaces sent one batch-wide template set, never sent a
 * quantity at all, and never previewed — so it told the operator to "send
 * them separately" whenever a batch was not uniform, which is exactly the
 * un-collated behaviour #1597 was filed to end.
 *
 * The Review step is the point: it asks the server what it would do and shows
 * the answer, rather than committing blind.
 */
export const CollateDesignsWizard = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: CollateDesignsWizardProps) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const { task_templates: taskTemplates = [] } = useTaskTemplates({
    limit: 100,
    offset: 0,
  })

  const [step, setStep] = useState<Step>(Step.DESIGNS)
  const [rows, setRows] = useState<DesignPlanRow[]>([])
  const [batchTemplateIds, setBatchTemplateIds] = useState<string[]>([])
  const [perDesignProcess, setPerDesignProcess] = useState(false)
  const [selectedPartnerId, setSelectedPartnerId] = useState("")
  const [partnerSearch, setPartnerSearch] = useState("")
  const [separateOrder, setSeparateOrder] = useState(false)
  const [windowDays, setWindowDays] = useState<number>(
    DEFAULT_COLLATION_WINDOW_DAYS
  )
  const [isSending, setIsSending] = useState(false)
  const [preview, setPreview] = useState<
    ProduceDesignsResponse["design_production"] | null
  >(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  /**
   * A STABLE identity for the selection.
   *
   * 🔴 The re-seed below must not depend on the `selectedDesigns` array
   * itself: the list page rebuilds it on every render, so a background
   * refetch — `usePartners` and `useTaskTemplates` refetch on window focus —
   * re-ran the effect and wiped the operator's templates, partner and step
   * mid-wizard. Nothing errored; the wizard just quietly forgot, and Send
   * then bailed as "blocked" having created nothing. Keying on the ids means
   * it re-seeds when the selection genuinely changes, and never otherwise.
   */
  const selectionKey = selectedDesigns.map((d) => d.id).join(",")

  /**
   * Re-seed from the list selection every time the wizard opens. The drawer
   * froze its set at mount; re-seeding is what lets the Designs step drop one
   * without closing and re-selecting on the list behind it.
   */
  useEffect(() => {
    if (!open) return
    setRows(
      selectedDesigns.map((d) => ({
        design_id: d.id,
        name: d.name || d.id,
        include: true,
        quantity: 1,
        template_ids: null,
      }))
    )
    setStep(Step.DESIGNS)
    setBatchTemplateIds([])
    setPerDesignProcess(false)
    setSelectedPartnerId("")
    setPartnerSearch("")
    setSeparateOrder(false)
    setWindowDays(DEFAULT_COLLATION_WINDOW_DAYS)
    setPreview(null)
    setPreviewError(null)
    // `selectionKey`, never `selectedDesigns` — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectionKey])

  const templateName = useCallback(
    (id: string) =>
      String(
        (taskTemplates as any[]).find((t) => String(t?.id) === String(id))
          ?.name ?? id
      ),
    [taskTemplates]
  )

  const templatesByCategory = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const tpl of taskTemplates as any[]) {
      const category =
        typeof tpl?.category === "object"
          ? tpl.category?.name || "Uncategorized"
          : String(tpl?.category || "Uncategorized")
      groups.set(category, [...(groups.get(category) || []), tpl])
    }
    return [...groups.entries()]
  }, [taskTemplates])

  const included = useMemo(() => rows.filter((r) => r.include), [rows])

  /** What a row will actually be sent with, once inheritance is resolved. */
  const resolvedTemplates = useCallback(
    (row: DesignPlanRow) => row.template_ids ?? batchTemplateIds,
    [batchTemplateIds]
  )

  const filteredPartners = useMemo(() => {
    if (!partnerSearch) return partners
    const q = partnerSearch.toLowerCase()
    return partners.filter(
      (p: AdminPartner) =>
        p.name?.toLowerCase().includes(q) || p.handle?.toLowerCase().includes(q)
    )
  }, [partners, partnerSearch])

  const selectedPartner = partners.find(
    (p: AdminPartner) => p.id === selectedPartnerId
  )

  const updateRow = (designId: string, patch: Partial<DesignPlanRow>) =>
    setRows((prev) =>
      prev.map((r) => (r.design_id === designId ? { ...r, ...patch } : r))
    )

  const toggleRowTemplate = (designId: string, templateId: string) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.design_id !== designId) return r
        const current = r.template_ids ?? batchTemplateIds
        return {
          ...r,
          template_ids: current.includes(templateId)
            ? current.filter((t) => t !== templateId)
            : [...current, templateId],
        }
      })
    )

  const toggleBatchTemplate = (id: string) =>
    setBatchTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )

  /**
   * Why the step cannot be left, or null when it can. Returned as a message so
   * a disabled Continue always says what is missing — a dead button with no
   * explanation is the shape that wasted a session on #1671.
   */
  const blockedReason = useCallback(
    (s: Step): string | null => {
      switch (s) {
        case Step.DESIGNS:
          return included.length ? null : "Include at least one design."
        case Step.PROCESS: {
          const bare = included.filter((r) => !resolvedTemplates(r).length)
          if (!bare.length) return null
          return `${bare.length} design${
            bare.length > 1 ? "s have" : " has"
          } no task template — the partner would get work with nothing to accept.`
        }
        case Step.QUANTITIES: {
          const bad = included.filter(
            (r) => !Number.isInteger(r.quantity) || r.quantity < 1
          )
          return bad.length
            ? `${bad.length} design${
                bad.length > 1 ? "s need" : " needs"
              } a whole quantity of 1 or more.`
            : null
        }
        case Step.COLLATION:
          return selectedPartnerId ? null : "Select a partner."
        default:
          return null
      }
    },
    [included, resolvedTemplates, selectedPartnerId]
  )

  /** The first step that is not yet satisfied, so a jump can never skip it. */
  const firstBlocked = useMemo(() => {
    for (const s of STEP_ORDER) {
      if (blockedReason(s)) return s
    }
    return null
  }, [blockedReason])

  const stepStatus = (s: Step): ProgressStatus => {
    if (s === step) return "in-progress"
    return STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(step) && !blockedReason(s)
      ? "completed"
      : "not-started"
  }

  const buildPayload = (dryRun: boolean) => ({
    designs: included.map((r) => ({
      design_id: r.design_id,
      template_ids: resolvedTemplates(r),
      quantity: r.quantity,
    })),
    partner_id: selectedPartnerId,
    /**
     * The batch fallback rides along so the server resolves inheritance the
     * same way this screen just displayed it, even for a row sent bare.
     */
    template_ids: batchTemplateIds,
    /**
     * #1597 — sent explicitly so the screen's own choice decides, not a server
     * default that could change underneath it.
     */
    collate: separateOrder ? "new" : "partner-open",
    ...(separateOrder ? {} : { collate_within_days: windowDays }),
    ...(dryRun ? { dry_run: true } : {}),
  })

  /**
   * Ask the server what it would do. `dry_run` creates nothing, so this is
   * safe to re-run whenever the plan changes.
   */
  const runPreview = useCallback(async () => {
    if (!selectedPartnerId || !included.length) return
    setIsPreviewing(true)
    setPreviewError(null)
    try {
      const { design_production } =
        await sdk.client.fetch<ProduceDesignsResponse>(
          `/admin/designs/produce`,
          { method: "POST", body: buildPayload(true) }
        )
      setPreview(design_production)
    } catch (err: any) {
      setPreview(null)
      setPreviewError(
        err?.message || "Could not preview this batch. Check the plan above."
      )
    } finally {
      setIsPreviewing(false)
    }
  }, [
    selectedPartnerId,
    included,
    batchTemplateIds,
    separateOrder,
    windowDays,
    rows,
  ])

  useEffect(() => {
    if (step === Step.REVIEW) void runPreview()
  }, [step, runPreview])

  const goTo = (target: Step) => {
    const targetIdx = STEP_ORDER.indexOf(target)
    // Going back is always allowed; going forward may not skip a blocked step.
    if (targetIdx > STEP_ORDER.indexOf(step)) {
      for (const s of STEP_ORDER.slice(0, targetIdx)) {
        const reason = blockedReason(s)
        if (reason) {
          setStep(s)
          toast.error(reason)
          return
        }
      }
    }
    setStep(target)
  }

  const onNext = () => {
    const reason = blockedReason(step)
    if (reason) {
      toast.error(reason)
      return
    }
    const idx = STEP_ORDER.indexOf(step)
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1])
  }

  const onBack = () => {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1])
  }

  const handleClose = (next: boolean) => {
    if (next) return
    if (isSending) return
    onOpenChange(false)
  }

  const handleSend = async () => {
    if (firstBlocked) {
      setStep(firstBlocked)
      toast.error(blockedReason(firstBlocked) as string)
      return
    }

    setIsSending(true)
    try {
      const { design_production } =
        await sdk.client.fetch<ProduceDesignsResponse>(
          `/admin/designs/produce`,
          { method: "POST", body: buildPayload(false) }
        )

      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })

      // Per-design failure isolation means a partial batch is a real outcome,
      // not an error — say so rather than reporting a clean success (#1263).
      const undispatched = design_production.not_dispatched || []
      if (undispatched.length) {
        toast.warning(
          `${undispatched.length} of ${design_production.created} design${
            design_production.created > 1 ? "s" : ""
          } were not dispatched`,
          {
            description:
              undispatched[0]?.reason ||
              "Their runs exist but carry no tasks — dispatch them from the run page.",
          }
        )
      }

      toast.success(
        `Sent ${design_production.created} design${
          design_production.created > 1 ? "s" : ""
        } to ${selectedPartner?.name || "partner"}`,
        {
          description: design_production.work_order_id
            ? design_production.work_order_joined
              ? "Added to this partner's open work-order — open it to track production."
              : "One work-order created — open it to track production."
            : undefined,
          action: design_production.work_order_id
            ? {
                label: "View work-order",
                altText: "View the created work-order",
                onClick: () =>
                  navigate(`/orders/${design_production.work_order_id}`),
              }
            : undefined,
        }
      )
      onOpenChange(false)
      onComplete()
    } catch (err: any) {
      toast.error("Failed to send to production", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsSending(false)
    }
  }

  const TemplateChips = ({
    selected,
    onToggle,
  }: {
    selected: string[]
    onToggle: (id: string) => void
  }) => (
    <div className="max-h-[260px] overflow-y-auto">
      {templatesByCategory.map(([categoryName, templates]) => (
        <div key={categoryName} className="mb-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
            {categoryName}
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tpl: any) => {
              const id = String(tpl.id)
              return (
                <button key={id} type="button" onClick={() => onToggle(id)}>
                  <Badge
                    size="2xsmall"
                    color={selected.includes(id) ? "green" : "grey"}
                  >
                    {String(tpl.name)}
                  </Badge>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  const currentBlock = blockedReason(step)

  return (
    <FocusModal open={open} onOpenChange={handleClose}>
      <FocusModal.Content>
        <ProgressTabs
          value={step}
          onValueChange={(v) => goTo(v as Step)}
          className="flex h-full flex-col overflow-hidden"
        >
          <FocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                {STEP_ORDER.map((s) => (
                  <ProgressTabs.Trigger
                    key={s}
                    value={s}
                    status={stepStatus(s)}
                    className="max-w-[200px] truncate"
                  >
                    {STEP_LABEL[s]}
                  </ProgressTabs.Trigger>
                ))}
              </ProgressTabs.List>
            </div>
          </FocusModal.Header>

          {/*
            Radix requires a title; a wizard with none is the a11y bug that
            shipped on the quote items modal's loading branch. `asChild` so the
            class lands on an element that actually hides — passing `sr-only`
            to Title directly rendered the words on screen, under the tabs.
          */}
          <FocusModal.Title asChild>
            <span className="sr-only">Send designs to production</span>
          </FocusModal.Title>

          <FocusModal.Body className="size-full overflow-hidden">
            {/* ---------------------------------------------- Designs */}
            <ProgressTabs.Content
              value={Step.DESIGNS}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <Heading className="text-xl">Designs in this batch</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  These become one work-order the partner sees as a single job.
                  Drop any that do not belong without leaving the wizard.
                </Text>
                <div className="flex flex-col gap-y-1">
                  {rows.map((row) => (
                    <label
                      key={row.design_id}
                      className="bg-ui-bg-component hover:bg-ui-bg-component-hover flex cursor-pointer items-center gap-x-3 rounded-md px-3 py-2.5"
                    >
                      <Checkbox
                        checked={row.include}
                        onCheckedChange={(v) =>
                          updateRow(row.design_id, { include: v === true })
                        }
                      />
                      <span className="txt-small flex-1">{row.name}</span>
                    </label>
                  ))}
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {included.length} of {rows.length} included.
                </Text>
              </div>
            </ProgressTabs.Content>

            {/* ---------------------------------------------- Process */}
            <ProgressTabs.Content
              value={Step.PROCESS}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <Heading className="text-xl">Process</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  The task templates the partner is asked to run. Selected by
                  id, never name — dispatch refuses an ambiguous name (#1262).
                </Text>

                <div>
                  <Label className="mb-1.5">Applies to every design</Label>
                  <TemplateChips
                    selected={batchTemplateIds}
                    onToggle={toggleBatchTemplate}
                  />
                </div>

                <div className="border-ui-border-base flex items-start gap-x-2 rounded-lg border p-3">
                  <Checkbox
                    id="per-design-process"
                    checked={perDesignProcess}
                    onCheckedChange={(v) => {
                      const on = v === true
                      setPerDesignProcess(on)
                      // Leaving per-design mode returns every row to the batch
                      // default, so what is shown is what will be sent.
                      if (!on) {
                        setRows((prev) =>
                          prev.map((r) => ({ ...r, template_ids: null }))
                        )
                      }
                    }}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor="per-design-process" weight="plus" size="small">
                      Different process per design
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      The parked-run recovery found 7 runs using 4 different
                      template sets (#1261). Without this, a mixed batch had to
                      be sent as separate orders — which is the opposite of
                      collating it.
                    </Text>
                  </div>
                </div>

                {perDesignProcess && (
                  <div className="flex flex-col gap-y-4">
                    {included.map((row) => (
                      <div
                        key={row.design_id}
                        className="border-ui-border-base rounded-lg border p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <Text size="small" weight="plus">
                            {row.name}
                          </Text>
                          {row.template_ids === null ? (
                            <Badge size="2xsmall" color="grey">
                              batch default
                            </Badge>
                          ) : (
                            <Button
                              size="small"
                              variant="transparent"
                              onClick={() =>
                                updateRow(row.design_id, { template_ids: null })
                              }
                            >
                              Reset to batch
                            </Button>
                          )}
                        </div>
                        <TemplateChips
                          selected={resolvedTemplates(row)}
                          onToggle={(id) => toggleRowTemplate(row.design_id, id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ProgressTabs.Content>

            {/* ---------------------------------------------- Quantities */}
            <ProgressTabs.Content
              value={Step.QUANTITIES}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <Heading className="text-xl">Quantities</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  How many of each design this partner is being asked to make.
                  The drawer this replaces sent none, so every run was born at
                  a quantity of 1 whatever the operator intended.
                </Text>

                <div className="flex items-end gap-x-2">
                  <div className="flex flex-col">
                    <Label size="small" className="mb-1.5">
                      Set every design to
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="w-32"
                      placeholder="e.g. 25"
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isInteger(n) && n >= 1) {
                          setRows((prev) =>
                            prev.map((r) =>
                              r.include ? { ...r, quantity: n } : r
                            )
                          )
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-y-1">
                  {included.map((row) => (
                    <div
                      key={row.design_id}
                      className="bg-ui-bg-component flex items-center gap-x-3 rounded-md px-3 py-2"
                    >
                      <span className="txt-small flex-1">{row.name}</span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        className="w-28"
                        value={String(row.quantity)}
                        onChange={(e) =>
                          updateRow(row.design_id, {
                            quantity: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </ProgressTabs.Content>

            {/* ---------------------------------------------- Collation */}
            <ProgressTabs.Content
              value={Step.COLLATION}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <Heading className="text-xl">Partner &amp; collation</Heading>

                <div>
                  <Label className="mb-1.5">Partner</Label>
                  <Input
                    placeholder="Search partners..."
                    value={partnerSearch}
                    onChange={(e) => setPartnerSearch(e.target.value)}
                    className="mb-2"
                  />
                  <div className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto">
                    {filteredPartners.length === 0 ? (
                      <Text
                        size="small"
                        className="text-ui-fg-subtle py-4 text-center"
                      >
                        No partners found
                      </Text>
                    ) : (
                      filteredPartners.map((partner: AdminPartner) => (
                        <button
                          key={partner.id}
                          type="button"
                          onClick={() => setSelectedPartnerId(partner.id)}
                          className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                            selectedPartnerId === partner.id
                              ? "bg-ui-bg-interactive text-ui-fg-on-color"
                              : "bg-ui-bg-component hover:bg-ui-bg-component-hover text-ui-fg-base"
                          }`}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="text-sm font-medium">
                              {partner.name}
                            </span>
                            <span
                              className={`text-xs ${
                                selectedPartnerId === partner.id
                                  ? "text-ui-fg-on-color/70"
                                  : "text-ui-fg-subtle"
                              }`}
                            >
                              {partner.handle}
                            </span>
                          </div>
                          <Badge
                            size="2xsmall"
                            color={
                              partner.status === "active"
                                ? selectedPartnerId === partner.id
                                  ? "grey"
                                  : "green"
                                : "orange"
                            }
                          >
                            {partner.status}
                          </Badge>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-ui-border-base flex items-start gap-x-2 rounded-lg border p-3">
                  <Checkbox
                    id="separate-work-order"
                    checked={separateOrder}
                    onCheckedChange={(v) => setSeparateOrder(v === true)}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor="separate-work-order" weight="plus" size="small">
                      Start a separate work-order
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {separateOrder
                        ? "These designs get their own work-order, billed on its own."
                        : `These designs join ${
                            selectedPartner?.name || "the partner"
                          }'s open work-order if they have a recent one — otherwise a new one is created.`}
                    </Text>
                  </div>
                </div>

                {!separateOrder && (
                  <div>
                    <Label size="small" className="mb-1.5">
                      Join a work-order opened within
                    </Label>
                    <div className="flex items-center gap-x-2">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        className="w-28"
                        value={String(windowDays)}
                        onChange={(e) => setWindowDays(Number(e.target.value))}
                      />
                      <Text size="small" className="text-ui-fg-subtle">
                        days
                      </Text>
                    </div>
                  </div>
                )}
              </div>
            </ProgressTabs.Content>

            {/* ---------------------------------------------- Review */}
            <ProgressTabs.Content
              value={Step.REVIEW}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <Heading className="text-xl">Review</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Nothing has been created yet. This is the server's own plan
                  for this batch, from a dry run.
                </Text>

                {isPreviewing && (
                  <Text size="small" className="text-ui-fg-subtle">
                    Working out what would happen…
                  </Text>
                )}

                {previewError && (
                  <div className="border-ui-border-error rounded-lg border p-3">
                    <Text size="small" className="text-ui-fg-error">
                      {previewError}
                    </Text>
                  </div>
                )}

                {preview && !isPreviewing && (
                  <>
                    <div className="border-ui-border-base rounded-lg border p-3">
                      <Text size="small" weight="plus">
                        {preview.work_order_id
                          ? "Joins an open work-order"
                          : "Creates a new work-order"}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {preview.work_order_id
                          ? `These ${included.length} line${
                              included.length > 1 ? "s" : ""
                            } are appended to ${
                              selectedPartner?.name || "the partner"
                            }'s work-order ${preview.work_order_id}.`
                          : separateOrder
                          ? "Billed on its own, as asked."
                          : `${
                              selectedPartner?.name || "This partner"
                            } has no work-order opened in the last ${windowDays} days, so a new one is minted.`}
                      </Text>
                    </div>

                    <div className="flex flex-col gap-y-1">
                      {(preview.designs || []).map((d) => {
                        const row = rows.find(
                          (r) => r.design_id === d.design_id
                        )
                        return (
                          <div
                            key={d.design_id}
                            className="bg-ui-bg-component flex items-start gap-x-3 rounded-md px-3 py-2.5"
                          >
                            <div className="flex flex-1 flex-col gap-y-1">
                              <span className="txt-small">
                                {row?.name || d.design_id}
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {d.template_ids.length ? (
                                  d.template_ids.map((t) => (
                                    <Badge key={t} size="2xsmall" color="blue">
                                      {templateName(t)}
                                    </Badge>
                                  ))
                                ) : (
                                  <Tooltip content="The run would be created with no tasks, so the partner has nothing to accept.">
                                    <Badge size="2xsmall" color="orange">
                                      no templates
                                    </Badge>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                            <Badge size="2xsmall" color="grey">
                              ×{d.quantity ?? row?.quantity ?? 1}
                            </Badge>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </ProgressTabs.Content>
          </FocusModal.Body>

          <FocusModal.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              {currentBlock && (
                <Text size="xsmall" className="text-ui-fg-subtle mr-auto">
                  {currentBlock}
                </Text>
              )}
              <Button
                size="small"
                variant="secondary"
                onClick={() => handleClose(false)}
                disabled={isSending}
              >
                Cancel
              </Button>
              {step !== Step.DESIGNS && (
                <Button
                  size="small"
                  variant="secondary"
                  type="button"
                  onClick={onBack}
                  disabled={isSending}
                >
                  Back
                </Button>
              )}
              {step === Step.REVIEW ? (
                <Button
                  size="small"
                  variant="primary"
                  onClick={handleSend}
                  isLoading={isSending}
                  disabled={isSending || isPreviewing}
                >
                  {`Send ${included.length} design${
                    included.length > 1 ? "s" : ""
                  }`}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="primary"
                  type="button"
                  onClick={onNext}
                  disabled={Boolean(currentBlock)}
                >
                  Continue
                </Button>
              )}
            </div>
          </FocusModal.Footer>
        </ProgressTabs>
      </FocusModal.Content>
    </FocusModal>
  )
}
