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
  Tooltip,
  clx,
} from "@medusajs/ui"
import { useCreatePaymentSubmission } from "../../../hooks/api/payment-submissions"
import type { Message } from "../../../hooks/api/messaging"
import { useDesigns } from "../../../hooks/api/designs"
import { usePartnerTasks } from "../../../hooks/api/partner-tasks"
import { extractSuggestedAmount } from "./extract-amount"

// Small reusable chip-picker: search input → dropdown of suggestions →
// selected items rendered as removable chips above the input. Used
// twice in this modal (designs + tasks). Kept inline because the rest
// of the codebase doesn't have a need for it yet; promote to a shared
// component when a second consumer shows up.
type PickerItem = { id: string; label: string; sub?: string }
const ChipPicker = ({
  items,
  selected,
  onAdd,
  onRemove,
  placeholder,
  loading,
}: {
  items: PickerItem[]
  selected: PickerItem[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  placeholder: string
  loading?: boolean
}) => {
  const [search, setSearch] = useState("")
  const [openDropdown, setOpenDropdown] = useState(false)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selectedIds = new Set(selected.map((s) => s.id))
    return items
      .filter((i) => !selectedIds.has(i.id))
      .filter(
        (i) =>
          !q ||
          i.label.toLowerCase().includes(q) ||
          i.sub?.toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [items, selected, search])

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((s) => (
            <Badge
              key={s.id}
              size="2xsmall"
              color="grey"
              className="cursor-pointer"
              onClick={() => onRemove(s.id)}
              title="Remove"
            >
              {s.label} ×
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpenDropdown(true)
          }}
          onFocus={() => setOpenDropdown(true)}
          onBlur={() => {
            // Delay so click on dropdown item lands before blur kills it.
            setTimeout(() => setOpenDropdown(false), 150)
          }}
          placeholder={placeholder}
          disabled={loading}
        />
        {openDropdown && (filtered.length > 0 || (!loading && search)) && (
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-ui-border-base bg-ui-bg-base shadow-md">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ui-fg-muted">
                No matches.
              </div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep input focus
                  onClick={() => {
                    onAdd(it.id)
                    setSearch("")
                  }}
                  className={clx(
                    "block w-full text-left px-3 py-2 text-sm",
                    "hover:bg-ui-bg-base-hover",
                  )}
                >
                  <div className="font-medium truncate">{it.label}</div>
                  {it.sub && (
                    <div className="text-xs text-ui-fg-muted truncate">
                      {it.sub}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type Props = {
  open: boolean
  onClose: () => void
  message: Message | null
  partnerId: string
  partnerName: string
}

export const CreatePaymentFromMessageModal = ({
  open,
  onClose,
  message,
  partnerId,
  partnerName,
}: Props) => {
  const suggested = useMemo(
    () => extractSuggestedAmount(message?.content),
    [message?.id, message?.content],
  )

  const [amount, setAmount] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>([])
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])

  // Designs + tasks for the partner. The workflow requires at least one
  // design_id (createPaymentSubmissionWorkflow line 91), so we surface a
  // picker here rather than letting the submit fail with a server error.
  // Tasks are optional. Both are scoped server-side by partner_id so the
  // admin only sees this partner's eligible items.
  const { designs = [], isPending: designsLoading } = useDesigns(
    { partner_id: partnerId, limit: 200 },
    { enabled: !!partnerId && open },
  )
  const { tasks = [], isPending: tasksLoading } = usePartnerTasks(partnerId, {
    enabled: !!partnerId && open,
  })

  const designItems: PickerItem[] = useMemo(
    () =>
      (designs as any[]).map((d) => ({
        id: d.id,
        label: d.name || d.id,
        sub: d.status ? d.status.replace(/_/g, " ") : undefined,
      })),
    [designs],
  )
  const taskItems: PickerItem[] = useMemo(
    () =>
      (tasks as any[]).map((t) => ({
        id: t.id,
        label: t.title || t.id,
        sub: t.status ? t.status.replace(/_/g, " ") : undefined,
      })),
    [tasks],
  )
  const selectedDesigns = useMemo(
    () => designItems.filter((d) => selectedDesignIds.includes(d.id)),
    [designItems, selectedDesignIds],
  )
  const selectedTasks = useMemo(
    () => taskItems.filter((t) => selectedTaskIds.includes(t.id)),
    [taskItems, selectedTaskIds],
  )

  // Reset form whenever a new message is loaded into the modal so we don't
  // leak the previous amount/notes/selections across separate clicks.
  useEffect(() => {
    if (!message) return
    setAmount(suggested ? String(suggested) : "")
    setNotes(message.content?.trim() ?? "")
    setSelectedDesignIds([])
    setSelectedTaskIds([])
  }, [message?.id, suggested])

  const createMutation = useCreatePaymentSubmission({
    onSuccess: ({ payment_submission }) => {
      toast.success(`Draft payment submission ${payment_submission.id} created.`)
      onClose()
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create payment submission")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message) return

    const numericAmount = Number(amount.replace(/,/g, ""))
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("Enter a valid amount")
      return
    }

    // The workflow requires ≥1 design — fail fast in the UI rather than
    // at the server with an opaque MedusaError.
    if (selectedDesignIds.length === 0) {
      toast.error("Pick at least one design to associate with this payment")
      return
    }

    // Documents from the message: the inbound media if any. Filename falls
    // back to the URL's last segment so the review UI has something to show.
    const documents = message.media_url
      ? [
          {
            url: message.media_url,
            filename: message.media_url.split("/").pop() || "attachment",
            mimeType: message.media_mime_type ?? undefined,
          },
        ]
      : undefined

    createMutation.mutate({
      partner_id: partnerId,
      design_ids: selectedDesignIds,
      task_ids: selectedTaskIds,
      notes: notes || undefined,
      documents,
      metadata: {
        // Suggested amount (the one we extracted, if any) is stamped
        // separately so review UIs can later show "we extracted ₹X,
        // operator entered ₹Y" if the operator edited the value.
        suggested_amount: suggested ?? null,
        entered_amount: numericAmount,
        from_message_id: message.id,
        from_conversation_id: message.conversation_id,
        source: "messaging_inbox_extract",
      },
    })
  }

  const messageHasMedia = !!message?.media_url
  const isImage = !!(message?.media_mime_type ?? "").startsWith("image/")

  return (
    <FocusModal open={open} onOpenChange={(o) => !o && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Text size="large" weight="plus">
            Create payment request
          </Text>
        </FocusModal.Header>
        <FocusModal.Body className="overflow-y-auto">
          <form onSubmit={handleSubmit} className="mx-auto max-w-2xl py-8 px-6">
            <div className="mb-6">
              <Text size="small" className="text-ui-fg-subtle">
                For partner
              </Text>
              <Text weight="plus">{partnerName}</Text>
            </div>

            {message && (
              <div className="mb-6 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                <Text size="xsmall" className="text-ui-fg-muted mb-1">
                  Source message
                </Text>
                {messageHasMedia && isImage && (
                  <a
                    href={message.media_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mb-2"
                  >
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
                      📄 {message.media_url!.split("/").pop()}
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

            <div className="mb-4">
              <Label htmlFor="payment-amount">
                Amount (INR){" "}
                {suggested !== undefined && (
                  <Text size="xsmall" className="inline text-ui-fg-muted">
                    — suggested ₹{suggested.toLocaleString("en-IN")} from
                    message text
                  </Text>
                )}
              </Label>
              <Input
                id="payment-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 1500"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <Label>
                Linked designs{" "}
                <Text size="xsmall" className="inline text-ui-fg-muted">
                  — required, pick at least one
                </Text>
              </Label>
              <ChipPicker
                items={designItems}
                selected={selectedDesigns}
                onAdd={(id) =>
                  setSelectedDesignIds((prev) =>
                    prev.includes(id) ? prev : [...prev, id],
                  )
                }
                onRemove={(id) =>
                  setSelectedDesignIds((prev) => prev.filter((x) => x !== id))
                }
                placeholder={
                  designsLoading
                    ? "Loading designs…"
                    : `Search this partner's designs (${designItems.length} available)`
                }
                loading={designsLoading}
              />
            </div>

            <div className="mb-4">
              <Label>
                Linked tasks{" "}
                <Text size="xsmall" className="inline text-ui-fg-muted">
                  — optional
                </Text>
              </Label>
              <ChipPicker
                items={taskItems}
                selected={selectedTasks}
                onAdd={(id) =>
                  setSelectedTaskIds((prev) =>
                    prev.includes(id) ? prev : [...prev, id],
                  )
                }
                onRemove={(id) =>
                  setSelectedTaskIds((prev) => prev.filter((x) => x !== id))
                }
                placeholder={
                  tasksLoading
                    ? "Loading tasks…"
                    : `Search this partner's tasks (${taskItems.length} available)`
                }
                loading={tasksLoading}
              />
            </div>

            <div className="mb-6">
              <Label htmlFor="payment-notes">Notes</Label>
              <Textarea
                id="payment-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Defaults to the message text — edit as needed."
              />
            </div>

            <div className="flex justify-end gap-x-3">
              <Button variant="secondary" onClick={onClose} type="button">
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createMutation.isPending}
                disabled={createMutation.isPending}
              >
                Create draft submission
              </Button>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
