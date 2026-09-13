import {
  Badge,
  Button,
  FocusModal,
  Input,
  Select,
  StatusBadge,
  Text,
  Textarea,
  clx,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import { PartnerDesign } from "../../hooks/api/partner-designs"
import { planCompletionOutput } from "../../lib/completion-output"
import { resolveRunMaterialOptions } from "../../lib/run-materials"

export const UNIT_OPTIONS = [
  { value: "Meter", label: "Meter" },
  { value: "Yard", label: "Yard" },
  { value: "Kilogram", label: "Kilogram" },
  { value: "Gram", label: "Gram" },
  { value: "Piece", label: "Piece" },
  { value: "Roll", label: "Roll" },
  { value: "Other", label: "Other" },
]

type ConsumptionEntry = {
  inventory_item_id: string
  quantity: string
  unit_cost: string
  unit_of_measure: string
  notes: string
}

export const REJECTION_REASONS = [
  { value: "stitching_defect", label: "Stitching defect" },
  { value: "fabric_flaw", label: "Fabric flaw" },
  { value: "color_mismatch", label: "Color mismatch" },
  { value: "sizing_error", label: "Sizing error" },
  { value: "print_defect", label: "Print defect" },
  { value: "material_damage", label: "Material damage" },
  { value: "quality_below_standard", label: "Quality below standard" },
  { value: "other", label: "Other" },
]

export const CompleteRunForm = ({
  run,
  design,
  onComplete,
  open,
  onOpenChange,
  isLoading,
  isSample,
  existingConsumptionCount,
}: {
  run: any
  design: PartnerDesign
  onComplete: (body: any) => Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
  isLoading: boolean
  isSample: boolean
  existingConsumptionCount: number
}) => {
  // Only what THIS run was assigned. Falls back to the design's full bill of
  // materials when the run carries no allocation — which is every run made
  // before assignments could carry materials.
  const { options: inventoryItems, constrained: materialsConstrained } =
    resolveRunMaterialOptions(run, design)
  const tasks = run.tasks || []
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )
  const prompt = usePrompt()
  const runQuantity = run.quantity || 1

  // ── Step 1: Output ──
  const [producedQty, setProducedQty] = useState(String(runQuantity))
  const [rejectedQty, setRejectedQty] = useState("")
  const [rejectionReason, setRejectionReason] = useState("")
  const [rejectionNotes, setRejectionNotes] = useState("")
  /**
   * #1271 — what happened to units that were neither made nor rejected.
   * The backend allows a genuine shortfall, but only with `allow_shortfall`
   * AND a written explanation; without a control for it the only way past the
   * gate was to inflate `produced_quantity`, which is what the gate exists to
   * prevent.
   */
  const [shortfallReason, setShortfallReason] = useState("")

  /**
   * ── Step 2: Cost ──
   *
   * 🔴 Starts UNSET, not "total". It used to default to "total" with that
   * button highlighted, so a partner typing their PER-PIECE rate produced a run
   * labelled `cost_type: "total"` — and the payout billed it once: ₹850 for
   * nine garments, with nothing erroring and the number looking plausible.
   * The two readings differ by a factor of the run quantity, so there is no
   * safe default; the backend now refuses a cost with no type. (#1554)
   */
  const [costType, setCostType] = useState<"per_unit" | "total" | null>(null)
  const [partnerEstimate, setPartnerEstimate] = useState("")

  // ── Step 3: Additional materials ──
  const [showMaterialForm, setShowMaterialForm] = useState(false)
  const [consumptions, setConsumptions] = useState<ConsumptionEntry[]>([])

  const addConsumptionItem = (itemId: string) => {
    if (consumptions.some((c) => c.inventory_item_id === itemId)) return
    setConsumptions((prev) => [...prev, {
      inventory_item_id: itemId,
      quantity: "",
      unit_cost: "",
      unit_of_measure: "Meter",
      notes: "",
    }])
  }

  const removeConsumptionItem = (idx: number) => {
    setConsumptions((prev) => prev.filter((_, i) => i !== idx))
  }

  // Items not yet added to the form
  const availableItems = inventoryItems.filter(
    (item: any) => !consumptions.some((c) => c.inventory_item_id === item.id)
  )

  // ── Step 4: Notes ──
  const [completionNotes, setCompletionNotes] = useState("")

  // Derived values
  const produced = parseFloat(producedQty) || 0
  const rejected = parseFloat(rejectedQty) || 0
  const yieldPct = runQuantity > 0 ? Math.round((produced / runQuantity) * 100) : 0
  // Rejects are output too — output that failed. Anything left over is
  // unaccounted for, and the completion gate refuses it unless it is declared.
  const outputPlan = planCompletionOutput({
    ordered: runQuantity,
    produced,
    rejected,
    shortfallReason,
  })
  const unaccounted = outputPlan.unaccounted
  const costValue = parseFloat(partnerEstimate) || 0
  /**
   * 🔴 The payout multiplier is the ORDERED quantity, not the produced one —
   * see `runPayableAmount`: correcting a partner's output figure deliberately
   * does not move the money. This preview used `produced`, so on any run where
   * the two differed it showed a total the payment would never match.
   */
  const costUnits = runQuantity > 0 ? runQuantity : 1
  const totalCost = costType === "per_unit" ? Math.round(costValue * costUnits * 100) / 100 : costValue
  const perUnitCost = costType === "total" && costUnits > 0 ? Math.round(costValue / costUnits * 100) / 100 : costValue

  const updateConsumption = (idx: number, field: keyof ConsumptionEntry, value: string) => {
    setConsumptions((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    )
  }

  const buildBody = () => {
    const validConsumptions = consumptions
      .filter((c) => c.quantity && parseFloat(c.quantity) > 0)
      .map((c) => ({
        inventory_item_id: c.inventory_item_id,
        quantity: parseFloat(c.quantity),
        unit_cost: c.unit_cost ? parseFloat(c.unit_cost) : undefined,
        unit_of_measure: c.unit_of_measure,
        notes: c.notes || undefined,
      }))

    // A cost with no type is refused by the backend (#1554) — say so here
    // rather than letting the partner submit and read a 400. The two readings
    // differ by the run quantity, so neither can be assumed.
    if (costValue > 0 && !costType) {
      toast.error("Choose whether the cost is per piece or for the whole run")
      return
    }

    const body: any = {
      produced_quantity: produced,
    }
    if (rejected > 0) {
      body.rejected_quantity = rejected
      if (rejectionReason) body.rejection_reason = rejectionReason
      if (rejectionNotes.trim()) body.rejection_notes = rejectionNotes.trim()
    }
    if (costValue > 0) {
      body.partner_cost_estimate = costValue
      body.cost_type = costType
    }
    if (validConsumptions.length > 0) body.consumptions = validConsumptions

    // The shortfall explanation rides in `notes` — that is the field the gate
    // reads, and it keeps the reason with the completion rather than in a
    // side channel nobody looks at.
    const noteParts = [outputPlan.noteLine || "", completionNotes.trim()].filter(
      Boolean
    )

    if (noteParts.length) body.notes = noteParts.join("\n")
    if (outputPlan.allowShortfall) body.allow_shortfall = true

    return body
  }

  const handleSubmit = async () => {
    // Mirror the backend gate so the partner gets a control, not a 400 telling
    // them to do something the form could not express (#1271).
    if (outputPlan.needsReason) {
      toast.error(
        `${unaccounted} piece${unaccounted !== 1 ? "s" : ""} unaccounted for`,
        {
          description:
            "Say what happened to them — record them as rejected, or write the reason in the shortfall box. Don't raise the produced count to cover them.",
        }
      )
      return
    }

    const body = buildBody()

    // Warn if no cost data
    if (!costValue && !isSample) {
      const confirmed = await prompt({
        title: "Complete without a cost estimate?",
        description: "No production cost entered. This helps with pricing and margin tracking.",
        confirmText: "Complete Anyway",
        cancelText: "Go Back",
      })
      if (!confirmed) return
    }

    // Sample runs: stricter — warn if no cost AND no materials
    if (isSample && !costValue && existingConsumptionCount === 0 && !body.consumptions?.length) {
      const confirmed = await prompt({
        title: "Complete sample without cost or material data?",
        description: "Sample runs need this data for cost estimation. Are you sure?",
        confirmText: "Complete Anyway",
        cancelText: "Go Back",
      })
      if (!confirmed) return
    }

    await onComplete(body)
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title>Complete Production Run</FocusModal.Title>
          <FocusModal.Description>
            {runQuantity} piece{runQuantity !== 1 ? "s" : ""} ordered
            {isSample ? " · Sample run" : ""}
          </FocusModal.Description>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-6">
          <div className="flex w-full max-w-2xl flex-col gap-y-4 px-4">
      {pendingTasks.length > 0 && (
        <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3 mb-4">
          <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
            {pendingTasks.length} pending task(s) will be marked as done
          </Text>
          <div className="flex flex-col gap-y-0.5">
            {pendingTasks.map((t: any) => (
              <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
                &bull; {t.title || t.id}
              </Text>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: Output ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <Text size="small" weight="plus" className="mb-3">Output</Text>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Good pieces produced
            </Text>
            <Input
              type="number"
              min="0"
              max={runQuantity}
              step="1"
              value={producedQty}
              onChange={(e) => setProducedQty(e.target.value)}
            />
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Rejected
            </Text>
            <Input
              type="number"
              min="0"
              step="1"
              value={rejectedQty}
              onChange={(e) => setRejectedQty(e.target.value)}
            />
          </div>
        </div>

        {/* Yield indicator */}
        {produced > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ui-border-base">
            <StatusBadge color={yieldPct >= 90 ? "green" : yieldPct >= 70 ? "orange" : "red"}>
              {yieldPct}% yield
            </StatusBadge>
            <Text size="xsmall" className="text-ui-fg-muted">
              {produced} of {runQuantity} pieces
              {rejected > 0 ? ` · ${rejected} rejected` : ""}
              {unaccounted > 0 ? ` · ${unaccounted} unaccounted for` : ""}
            </Text>
          </div>
        )}

        {/*
          #1271 — the missing units. The form used to fill the rejected field
          with the remainder automatically, which recorded units that were
          never made as units that FAILED, and left a partner whose shortfall
          was something else (fabric ran out, order cut short) with no way
          through the completion gate except inflating the produced count.
        */}
        {unaccounted > 0 && (
          <div className="mt-3 pt-3 border-t border-ui-border-base">
            <div className="flex items-center justify-between gap-3 mb-2">
              <Text size="xsmall" weight="plus" className="text-ui-tag-orange-text">
                {unaccounted} piece{unaccounted !== 1 ? "s" : ""} not accounted for
              </Text>
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => {
                  setRejectedQty(String(rejected + unaccounted))
                  setShortfallReason("")
                }}
              >
                They were rejected
              </Button>
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              If they failed quality, record them as rejected. Otherwise say what
              happened — a recorded shortfall is fine, a wrong produced count is not.
            </Text>
            <Textarea
              rows={2}
              placeholder="e.g. fabric ran out after 8 pieces — remaining 2 not cut"
              value={shortfallReason}
              onChange={(e) => setShortfallReason(e.target.value)}
            />
          </div>
        )}

        {/* Rejection details */}
        {rejected > 0 && (
          <div className="mt-3 pt-3 border-t border-ui-border-base">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">Reason</Text>
                <Select value={rejectionReason} onValueChange={setRejectionReason}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select reason" />
                  </Select.Trigger>
                  <Select.Content>
                    {REJECTION_REASONS.map((r) => (
                      <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">Details (optional)</Text>
                <Input
                  placeholder="e.g. thread pull on collar"
                  value={rejectionNotes}
                  onChange={(e) => setRejectionNotes(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 2: Cost ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <Text size="small" weight="plus" className="mb-1">
          Your production cost
          {isSample && <span className="text-ui-fg-error ml-1">*</span>}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle mb-3">
          {isSample
            ? "Your charge for producing this sample. This feeds directly into pricing."
            : "Your charge for this production run (labor, overheads, margin)."
          }
        </Text>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[200px]">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={partnerEstimate}
              onChange={(e) => setPartnerEstimate(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg border border-ui-border-base overflow-hidden">
            <button
              type="button"
              className={clx(
                "px-3 py-2 text-xs transition-colors",
                costType === "per_unit"
                  ? "bg-ui-bg-interactive text-ui-fg-on-color"
                  : "bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
              )}
              onClick={() => setCostType("per_unit")}
            >
              Per piece
            </button>
            <button
              type="button"
              className={clx(
                "px-3 py-2 text-xs transition-colors border-l border-ui-border-base",
                costType === "total"
                  ? "bg-ui-bg-interactive text-ui-fg-on-color"
                  : "bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
              )}
              onClick={() => setCostType("total")}
            >
              Total
            </button>
          </div>
        </div>

        {/* What this run will actually pay.
            🔴 Stated against the ORDERED quantity, because that is the
            multiplier the payout uses (`runPayableAmount`). The old line used
            the produced figure, so on any run where the two differed it
            previewed a total the payment would never match. */}
        {costValue > 0 && costType && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ui-border-base">
            <Text size="xsmall" className="text-ui-fg-muted">
              {(() => {
                const cur = ((design as any)?.cost_currency || "").toUpperCase()
                const prefix = cur ? `${cur} ` : ""
                return costType === "per_unit"
                  ? `${prefix}${costValue} × ${costUnits} ordered = ${prefix}${totalCost} total`
                  : `${prefix}${totalCost} total · ${prefix}${perUnitCost} per piece of ${costUnits}`
              })()}
            </Text>
          </div>
        )}

        {/* The unchosen state is a real state, and silence about it is how the
            per-piece rate got billed once. */}
        {costValue > 0 && !costType && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ui-border-base">
            <Text size="xsmall" className="text-ui-fg-error">
              Is that per piece, or for all {costUnits}? The two are paid very
              differently.
            </Text>
          </div>
        )}
      </div>

      {/* ── Step 3: Materials ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <Text size="small" weight="plus">
            Materials
            {isSample && <span className="text-ui-fg-error ml-1">*</span>}
          </Text>
          {existingConsumptionCount > 0 && (
            <Badge size="2xsmall" color="green">
              {existingConsumptionCount} already logged
            </Badge>
          )}
        </div>

        {materialsConstrained && (
          <Text size="xsmall" className="text-ui-fg-subtle mb-2">
            This run was assigned specific materials
            {inventoryItems.some((i) => i.planned_quantity != null)
              ? ` — ${inventoryItems
                  .filter((i) => i.planned_quantity != null)
                  .map((i) => `${i.title || i.sku || i.id}: ${i.planned_quantity}`)
                  .join(", ")}`
              : ""}
            . Only these can be logged against it.
          </Text>
        )}

        {existingConsumptionCount > 0 ? (
          <Text size="xsmall" className="text-ui-fg-subtle mb-3">
            {existingConsumptionCount} material entry(ies) were logged during production.
            {inventoryItems.length > 0 ? " Add more below if needed." : ""}
          </Text>
        ) : (
          <Text size="xsmall" className="text-ui-fg-subtle mb-3">
            {isSample
              ? "No materials logged yet. Record what was consumed — this data is critical for cost estimation."
              : "Log materials consumed during this run (optional)."
            }
          </Text>
        )}

        {/* Added items */}
        {consumptions.length > 0 && (
          <div className="flex flex-col gap-3 mt-3">
            {consumptions.map((entry, idx) => {
              const item = inventoryItems.find((i: any) => i.id === entry.inventory_item_id)
              const label = item?.title || item?.sku || entry.inventory_item_id
              return (
                <div key={entry.inventory_item_id} className="rounded-lg border border-ui-border-base p-3">
                  <div className="flex items-center justify-between mb-2">
                    <Text size="xsmall" weight="plus">{label}</Text>
                    <Button variant="transparent" size="small" onClick={() => removeConsumptionItem(idx)}>
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Qty</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={entry.quantity}
                        onChange={(e) => updateConsumption(idx, "quantity", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Cost/unit</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Optional"
                        value={entry.unit_cost}
                        onChange={(e) => updateConsumption(idx, "unit_cost", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Unit</Text>
                      <Select value={entry.unit_of_measure} onValueChange={(v) => updateConsumption(idx, "unit_of_measure", v)}>
                        <Select.Trigger><Select.Value /></Select.Trigger>
                        <Select.Content>
                          {UNIT_OPTIONS.map((o) => (
                            <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Notes</Text>
                      <Input
                        placeholder="Optional"
                        value={entry.notes}
                        onChange={(e) => updateConsumption(idx, "notes", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add item selector */}
        {availableItems.length > 0 && (
          <div className="mt-3">
            <Select onValueChange={(v) => { addConsumptionItem(v); setShowMaterialForm(true) }}>
              <Select.Trigger>
                <Select.Value placeholder="Add an inventory item..." />
              </Select.Trigger>
              <Select.Content>
                {availableItems.map((item: any) => (
                  <Select.Item key={item.id} value={item.id}>
                    {item.title || item.sku || item.id}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        )}
      </div>

      {/* ── Step 4: Notes ── */}
      <div className="mb-4">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
          Completion notes (optional)
        </Text>
        <Textarea
          placeholder="Quality observations, issues, or feedback for the admin team"
          value={completionNotes}
          onChange={(e) => setCompletionNotes(e.target.value)}
          rows={3}
        />
      </div>

          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <Button variant="secondary" size="small" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button size="small" onClick={handleSubmit} isLoading={isLoading}>
            Confirm & Complete
          </Button>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
