import { useState, useRef } from "react"
import { Button, DropdownMenu, Text } from "@medusajs/ui"
import { Photo, PaperClip, PencilSquare, XMark } from "@medusajs/icons"

export type MessageAttachment = {
  media_url: string
  media_mime_type: string
  media_filename?: string
}

export type MessageContext = {
  context_type: "production_run" | "inventory_item" | "design"
  context_id: string
  label: string
}

export type ReplyTo = {
  id: string
  content: string
  sender_name: string | null
  direction: "inbound" | "outbound"
  media_url?: string | null
  media_mime_type?: string | null
}

export type SendPayload = {
  content: string
  media_url?: string
  media_mime_type?: string
  media_filename?: string
  context_type?: string
  context_id?: string
  reply_to_id?: string
}

export const MessageInput = ({
  onSend,
  isSending,
  onAttachContext,
  replyTo,
  onCancelReply,
}: {
  onSend: (payload: SendPayload) => void
  isSending: boolean
  onAttachContext?: () => void
  replyTo?: ReplyTo | null
  onCancelReply?: () => void
}) => {
  const [text, setText] = useState("")
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if ((!trimmed && !attachment) || isSending) return

    const payload: SendPayload = {
      content: trimmed || (attachment ? `[${attachment.media_filename || "attachment"}]` : ""),
    }
    if (attachment) {
      payload.media_url = attachment.media_url
      payload.media_mime_type = attachment.media_mime_type
      payload.media_filename = attachment.media_filename
    }
    if (replyTo) {
      payload.reply_to_id = replyTo.id
    }

    onSend(payload)
    setText("")
    setAttachment(null)
    onCancelReply?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Create a temporary URL — in production this should upload to S3/media first
    const url = URL.createObjectURL(file)
    setAttachment({
      media_url: url,
      media_mime_type: file.type,
      media_filename: file.name,
    })

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-ui-border-base bg-ui-bg-base px-6 py-3"
    >
      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-ui-border-interactive bg-ui-bg-subtle px-3 py-2">
          <div className="flex-1 min-w-0">
            <Text size="xsmall" className="text-ui-fg-interactive font-medium">
              {replyTo.sender_name || (replyTo.direction === "inbound" ? "Partner" : "Admin")}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted truncate">
              {replyTo.content || (replyTo.media_url ? "Media" : "")}
            </Text>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-ui-fg-muted hover:text-ui-fg-base shrink-0"
          >
            <XMark className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Attachment preview */}
      {attachment && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <PaperClip className="h-4 w-4 text-ui-fg-muted shrink-0" />
          <Text size="small" className="text-ui-fg-subtle truncate flex-1">
            {attachment.media_filename || "Attachment"}
          </Text>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            className="text-ui-fg-muted hover:text-ui-fg-base"
          >
            <XMark className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 w-full">
        {/* Attachment buttons */}
        <div className="flex items-center gap-1 shrink-0 pb-0.5">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md p-1.5 text-ui-fg-muted hover:text-ui-fg-base hover:bg-ui-bg-base-hover transition-colors"
            title="Attach file"
          >
            <PaperClip className="h-4 w-4" />
          </button>
          {onAttachContext && (
            <button
              type="button"
              onClick={onAttachContext}
              className="rounded-md p-1.5 text-ui-fg-muted hover:text-ui-fg-base hover:bg-ui-bg-base-hover transition-colors"
              title="Attach design or context"
            >
              <PencilSquare className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Text input */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:border-ui-border-interactive min-h-[40px] max-h-[120px]"
          style={{
            height: "auto",
            overflow: text.split("\n").length > 3 ? "auto" : "hidden",
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = "auto"
            target.style.height = Math.min(target.scrollHeight, 120) + "px"
          }}
        />

        <Button
          type="submit"
          variant="primary"
          size="small"
          disabled={(!text.trim() && !attachment) || isSending}
          isLoading={isSending}
          className="shrink-0"
        >
          Send
        </Button>
      </div>
    </form>
  )
}
