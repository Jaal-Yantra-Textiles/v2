import { useEffect, useMemo, useState } from "react"
import {
  FocusModal,
  Button,
  Input,
  Label,
  Textarea,
  Text,
  Badge,
  toast,
  clx,
  Switch,
  Tooltip,
  Skeleton,
  Select,
  RadioGroup,
} from "@medusajs/ui"
import type { Message } from "../../../hooks/api/messaging"
import {
  useProductionRuns,
  useAddRunActivityNote,
  useAdminCompleteRun,
  useAttachMediaToRun,
  type AdminProductionRun,
} from "../../../hooks/api/production-runs"

export type MessageRunActionType = "activity_note" | "attach_media" | "complete_run"

type Props = {
  open: boolean
  onClose: () => void
  actionType: MessageRunActionType
  message: Message | null
  partnerId: string
  partnerName: string
  conversationId: string
  /** Called after a successful "complete_run" so the page can send a WhatsApp summary. */
  onRunCompleted?: (run: AdminProductionRun) => void
}

const NO_REJECTION = "none"

const REJECTION_REASONS = [
  { label: "—", value: NO_REJECTION },
  { label: "Stitching Defect", value: "stitching_defect" },
  { label: "Fabric Flaw", value: "fabric_flaw" },
  { label: "Color Mismatch", value: "color_mismatch" },
  { label: "Sizing Error", value: "sizing_error" },
  { label: "Print Defect", value: "print_defect" },
  { label: "Material Damage", value: "material_damage" },
  { label: "Quality Below Standard", value: "quality_below_standard" },
  { label: "Other", value: "other" },
] as const

const runStatusColors: Record<string, "green" | "orange" | "blue" | "grey" | "red"> = {
  draft: "grey",
  pending_review: "grey",
  approved: "blue",
  sent_to_partner: "blue",
  in_progress: "orange",
  completed: "green",
  cancelled: "red",
  awaiting_reassignment: "orange",
}

export const MessageRunActionModal = ({
  open,
  onClose,
  actionType,
  message,
  partnerId,
  partnerName,
  conversationId,
  onRunCompleted,
}: Props) => {
  const [selectedRunId, setSelectedRunId] = useState<string>("")
  const [noteText, setNoteText] = useState<string>("")
  const [producedQty, setProducedQty] = useState<string>("")
  const [rejectedQty, setRejectedQty] = useState<string>("")
  const [rejectionReason, setRejectionReason] = useState<string>("")
  const [rejectionNotes, setRejectionNotes] = useState<string>("")
  const [costEstimate, setCostEstimate] = useState<string>("")
  const [costType, setCostType] = useState<"per_unit" | "total">("total")
  const [allowShortfall, setAllowShortfall] = useState(false)
  const [sendSummary, setSendSummary] = useState(true)

  // Fetch the partner's production runs. complete_run asks the server for
  // in_progress runs only; activity_note / attach_media fetch the partner's
  // runs unfiltered and narrow client-side to the active ones, newest first.
  const statusFilter = actionType === "complete_run" ? "in_progress" : undefined
  const { production_runs = [], isPending: runsLoading } = useProductionRuns(
    { partner_id: partnerId, limit: 50, ...(statusFilter ? { status: statusFilter } : {}) },
    { enabled: !!partnerId && open }
  )

  // A message is only worth logging against a run that is live with this
  // partner. Completed/cancelled are terminal (a redo is a NEW run), and
  // awaiting_reassignment has no partner — it belongs to reassignment.
  const OPEN_RUN_STATUSES = ["in_progress", "sent_to_partner", "approved"]

  const productionRuns = useMemo(() => {
    const sorted = [...production_runs].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
      return bTime - aTime
    })
    if (actionType === "complete_run") return sorted
    return sorted.filter((r) => OPEN_RUN_STATUSES.includes(r.status))
  }, [production_runs, actionType])

  const noteMutation = useAddRunActivityNote(selectedRunId, {
    onSuccess: () => {
      toast.success("Activity note added to run")
      onClose()
    },
    onError: (err: any) => toast.error(err?.message || "Failed to add note"),
  })

  const completeMutation = useAdminCompleteRun(selectedRunId, {
    onSuccess: ({ production_run }) => {
      toast.success("Production run completed")
      if (sendSummary) onRunCompleted?.(production_run)
      onClose()
    },
    onError: (err: any) => toast.error(err?.message || "Failed to complete run"),
  })

  const attachMutation = useAttachMediaToRun(selectedRunId, {
    onSuccess: () => {
      toast.success("Media attached to run")
      onClose()
    },
    onError: (err: any) => toast.error(err?.message || "Failed to attach media"),
  })

  // Reset form when a new message loads
  useEffect(() => {
    if (!message) return
    setNoteText(message.content?.trim() ?? "")
    setProducedQty("")
    setRejectedQty("")
    setRejectionReason("")
    setRejectionNotes("")
    setCostEstimate("")
    setCostType("total")
    setAllowShortfall(false)
    setSendSummary(true)
    setSelectedRunId("")
  }, [message?.id, actionType])

  const selectedRun = useMemo(
    () => productionRuns.find((r) => r.id === selectedRunId),
    [productionRuns, selectedRunId]
  )

  const title = actionType === "activity_note"
    ? "Add to run activity log"
    : actionType === "attach_media"
    ? "Attach media to run"
    : "Complete production run"

  const isSubmitting =
    noteMutation.isPending || completeMutation.isPending || attachMutation.isPending

  // produced_quantity is REQUIRED to complete a run (a run with nothing made
  // is not a completion); rejected_quantity is optional but, once typed, must
  // be a non-negative number — otherwise "Complete run" stays disabled.
  const invalidQuantity = (raw: string) =>
    raw.trim() !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0)

  const completeRunDisabled =
    isSubmitting ||
    !selectedRunId ||
    (actionType === "complete_run" &&
      (producedQty.trim() === "" ||
        invalidQuantity(producedQty) ||
        invalidQuantity(rejectedQty)))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message || !selectedRunId) {
      toast.error("Select a production run")
      return
    }

    if (actionType === "activity_note") {
      if (!noteText.trim()) {
        toast.error("Note text cannot be empty")
        return
      }
      noteMutation.mutate({
        summary: noteText.trim(),
        message_id: message.id,
        conversation_id: conversationId,
        partner_id: partnerId,
      })
    } else if (actionType === "attach_media") {
      if (!message.media_url) {
        toast.error("This message has no media to attach")
        return
      }
      attachMutation.mutate({
        media_url: message.media_url,
        media_mime_type: message.media_mime_type ?? undefined,
        filename: (message.metadata as any)?.filename,
        message_id: message.id,
        conversation_id: conversationId,
      })
    } else if (actionType === "complete_run") {
      if (producedQty.trim() === "") {
        toast.error("Produced quantity is required")
        return
      }
      const produced = Number(producedQty)
      const rejected = rejectedQty ? Number(rejectedQty) : undefined
      if (!Number.isFinite(produced) || produced < 0) {
        toast.error("Produced quantity must be a non-negative number")
        return
      }
      if (rejected != null && (!Number.isFinite(rejected) || rejected < 0)) {
        toast.error("Rejected quantity must be a non-negative number")
        return
      }
      completeMutation.mutate({
        produced_quantity: produced,
        rejected_quantity: rejected,
        rejection_reason:
          rejectionReason && rejectionReason !== NO_REJECTION
            ? rejectionReason
            : undefined,
        rejection_notes: rejectionNotes || undefined,
        partner_cost_estimate: costEstimate ? Number(costEstimate) : undefined,
        cost_type: costType,
        notes: noteText.trim() || undefined,
        allow_shortfall: allowShortfall,
        from_message_id: message.id,
        from_conversation_id: conversationId,
      })
    }
  }

  const messageHasMedia = !!message?.media_url
  const isImage = !!(message?.media_mime_type ?? "").startsWith("image/")

  return (
    <FocusModal open={open} onOpenChange={(o) => !o && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Text size="large" weight="plus">{title}</Text>
        </FocusModal.Header>
        <FocusModal.Body className="overflow-y-auto">
          <form onSubmit={handleSubmit} className="mx-auto max-w-2xl py-8 px-6">
            {/* Partner context */}
            <div className="mb-6">
              <Text size="small" className="text-ui-fg-subtle">For partner</Text>
              <Text weight="plus">{partnerName}</Text>
            </div>

            {/* Source message preview */}
            {message && (
              <div className="mb-6 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                <Text size="xsmall" className="text-ui-fg-muted mb-1">Source message</Text>
                {messageHasMedia && isImage && (
                  <a href={message.media_url!} target="_blank" rel="noopener noreferrer" className="block mb-2">
                    <img
                      src={message.media_url!}
                      alt="attachment"
                      className="max-h-40 rounded-md object-cover"
                    />
                  </a>
                )}
                {messageHasMedia && !isImage && (
                  <Tooltip content="Open original">
                    <a
                      href={message.media_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ui-fg-interactive text-sm underline"
                    >
                      {message.media_url!.split("/").pop()}
                    </a>
                  </Tooltip>
                )}
                {message.content?.trim() && (
                  <Text size="small" className="whitespace-pre-wrap break-words">
                    {message.content}
                  </Text>
                )}
              </div>
            )}

            {/* Run picker */}
            <div className="mb-4">
              <Label>
                Production run{" "}
                <Text size="xsmall" className="inline text-ui-fg-muted">
                  — {actionType === "complete_run" ? "in-progress runs only" : "active runs (in-progress, sent to partner, approved)"}
                </Text>
              </Label>
              {runsLoading ? (
                <div className="space-y-2 mt-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : productionRuns.length === 0 ? (
                <Text size="small" className="text-ui-fg-muted mt-2">
                  No {actionType === "complete_run" ? "in-progress" : "open"} production runs found for this partner.
                </Text>
              ) : (
                <Select
                  value={selectedRunId}
                  onValueChange={setSelectedRunId}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select a production run…" />
                  </Select.Trigger>
                  <Select.Content>
                    {productionRuns.map((run) => (
                      <Select.Item key={run.id} value={run.id}>
                        <div className="flex items-center gap-2">
                          <Badge
                            color={runStatusColors[run.status || ""] || "grey"}
                            size="2xsmall"
                          >
                            {run.status?.replace(/_/g, " ")}
                          </Badge>
                          <span className="font-mono text-xs">{run.id.substring(0, 20)}…</span>
                          {run.quantity && <span className="text-ui-fg-muted text-xs">×{run.quantity}</span>}
                        </div>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            </div>

            {/* Selected run summary */}
            {selectedRun && (
              <div className="mb-4 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge color={runStatusColors[selectedRun.status || ""] || "grey"} size="2xsmall">
                    {selectedRun.status?.replace(/_/g, " ")}
                  </Badge>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {selectedRun.run_type} · qty {selectedRun.quantity ?? "—"}
                  </Text>
                </div>
                {selectedRun.produced_quantity != null && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Produced: {selectedRun.produced_quantity}
                    {selectedRun.rejected_quantity ? ` · Rejected: ${selectedRun.rejected_quantity}` : ""}
                  </Text>
                )}
              </div>
            )}

            {/* Action-specific fields */}
            {actionType === "activity_note" && (
              <div className="mb-6">
                <Label htmlFor="note-text">Activity note</Label>
                <Textarea
                  id="note-text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={4}
                  placeholder="Defaults to the message text — edit as needed."
                />
              </div>
            )}

            {actionType === "attach_media" && (
              <div className="mb-6">
                {!messageHasMedia ? (
                  <Text size="small" className="text-ui-fg-muted">
                    This message has no media attachment.
                  </Text>
                ) : (
                  <Text size="small" className="text-ui-fg-muted">
                    The media from this message will be attached to the selected run's metadata and recorded in its activity timeline.
                  </Text>
                )}
              </div>
            )}

            {actionType === "complete_run" && (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <Label htmlFor="produced-qty">Produced quantity</Label>
                    <Input
                      id="produced-qty"
                      type="number"
                      min={0}
                      value={producedQty}
                      onChange={(e) => setProducedQty(e.target.value)}
                      placeholder="e.g. 50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rejected-qty">Rejected quantity</Label>
                    <Input
                      id="rejected-qty"
                      type="number"
                      min={0}
                      value={rejectedQty}
                      onChange={(e) => setRejectedQty(e.target.value)}
                      placeholder="e.g. 2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <Label htmlFor="rejection-reason">Rejection reason</Label>
                    <Select
                      value={rejectionReason}
                      onValueChange={setRejectionReason}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="—" />
                      </Select.Trigger>
                      <Select.Content>
                        {REJECTION_REASONS.map((r) => (
                          <Select.Item key={r.value} value={r.value}>
                            {r.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="cost-estimate">Partner cost estimate</Label>
                    <Input
                      id="cost-estimate"
                      type="number"
                      min={0}
                      value={costEstimate}
                      onChange={(e) => setCostEstimate(e.target.value)}
                      placeholder="e.g. 1500"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <Label>Cost type</Label>
                  <RadioGroup
                    value={costType}
                    onValueChange={(v) => setCostType(v as "per_unit" | "total")}
                    className="flex items-center gap-4 mt-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <RadioGroup.Item id="cost-type-total" value="total" />
                      <Label htmlFor="cost-type-total" size="small">Total</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroup.Item id="cost-type-per-unit" value="per_unit" />
                      <Label htmlFor="cost-type-per-unit" size="small">Per unit</Label>
                    </div>
                  </RadioGroup>
                </div>

                {rejectionReason && rejectionReason !== NO_REJECTION && (
                  <div className="mb-4">
                    <Label htmlFor="rejection-notes">Rejection notes</Label>
                    <Textarea
                      id="rejection-notes"
                      value={rejectionNotes}
                      onChange={(e) => setRejectionNotes(e.target.value)}
                      rows={2}
                      placeholder="Describe the rejection…"
                    />
                  </div>
                )}

                <div className="mb-4">
                  <Label htmlFor="completion-notes">Completion notes</Label>
                  <Textarea
                    id="completion-notes"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Defaults to the partner's message text — edit as needed."
                  />
                </div>

                <div className="flex items-center gap-6 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={allowShortfall}
                      onCheckedChange={setAllowShortfall}
                    />
                    <Text size="small">Allow shortfall</Text>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={sendSummary}
                      onCheckedChange={setSendSummary}
                    />
                    <Text size="small">
                      Send WhatsApp summary to partner
                    </Text>
                  </label>
                </div>
              </>
            )}

            <div className="flex justify-end gap-x-3">
              <Button variant="secondary" onClick={onClose} type="button">
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={isSubmitting}
                disabled={completeRunDisabled}
              >
                {actionType === "activity_note" ? "Add note" : actionType === "attach_media" ? "Attach media" : "Complete run"}
              </Button>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
