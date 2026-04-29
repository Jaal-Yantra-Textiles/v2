import { useEffect, useMemo, useState } from "react"
import {
  FocusModal,
  Button,
  Input,
  Label,
  Textarea,
  Text,
  toast,
  Tooltip,
} from "@medusajs/ui"
import { useCreatePaymentSubmission } from "../../../hooks/api/payment-submissions"
import type { Message } from "../../../hooks/api/messaging"
import { extractSuggestedAmount } from "./extract-amount"

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

  // Reset form whenever a new message is loaded into the modal so we don't
  // leak the previous amount/notes across separate "Create payment" clicks.
  useEffect(() => {
    if (!message) return
    setAmount(suggested ? String(suggested) : "")
    setNotes(message.content?.trim() ?? "")
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
      // No design / task linkage from this surface — admin will associate
      // those during review. Keeping the create payload minimal lets the
      // partner WhatsApp text command (`payment 1500`) reuse the same
      // shape later without divergent code paths.
      design_ids: [],
      task_ids: [],
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
