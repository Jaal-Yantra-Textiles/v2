import { useState, useRef, useCallback } from "react"
import { Button, DropdownMenu, Text } from "@medusajs/ui"
import { Photo, PaperClip, PencilSquare, XMark } from "@medusajs/icons"
import { sdk } from "../../../lib/config"

export type MessageAttachment = {
  media_url: string
  media_mime_type: string
  media_filename?: string
  preview_url?: string // local blob URL for thumbnail preview
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
    if (attachment?.preview_url) URL.revokeObjectURL(attachment.preview_url)
    setAttachment(null)
    onCancelReply?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const [uploading, setUploading] = useState(false)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset file input immediately
    if (fileInputRef.current) fileInputRef.current.value = ""

    // Show local preview while uploading
    const previewUrl = URL.createObjectURL(file)
    setAttachment({
      media_url: previewUrl,
      media_mime_type: file.type,
      media_filename: file.name,
      preview_url: previewUrl,
    })

    // Upload to media module via admin API
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("files", file)

      const resp: any = await sdk.client.fetch("/admin/uploads", {
        method: "POST",
        body: formData,
      })

      // Extract the uploaded file URL
      const uploaded = resp?.files?.[0] || resp?.[0]
      const permanentUrl = uploaded?.url || uploaded?.file_path

      if (permanentUrl) {
        setAttachment({
          media_url: permanentUrl,
          media_mime_type: file.type,
          media_filename: file.name,
          preview_url: previewUrl, // keep local preview for display
        })
      }
      // If upload fails, keep the blob URL — the backend will still get the filename
      // and the send will fail gracefully
    } catch (err: any) {
      console.error("File upload failed:", err.message)
      // Keep the attachment with blob URL so user sees it, but it'll fail on send
    } finally {
      setUploading(false)
    }
  }, [])

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
        <div className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 ${uploading ? "border-orange-300 bg-orange-50" : "border-ui-border-base bg-ui-bg-subtle"}`}>
          {/* Thumbnail for images/videos */}
          {attachment.preview_url && attachment.media_mime_type?.startsWith("image/") ? (
            <img
              src={attachment.preview_url}
              alt=""
              className="h-10 w-10 rounded object-cover shrink-0"
            />
          ) : attachment.preview_url && attachment.media_mime_type?.startsWith("video/") ? (
            <video
              src={attachment.preview_url}
              className="h-10 w-10 rounded object-cover shrink-0"
            />
          ) : (
            <PaperClip className="h-4 w-4 text-ui-fg-muted shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <Text size="small" className="text-ui-fg-base truncate">
              {attachment.media_filename || "Attachment"}
            </Text>
            {uploading && (
              <Text size="xsmall" className="text-orange-500">Uploading...</Text>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url)
              setAttachment(null)
            }}
            className="text-ui-fg-muted hover:text-ui-fg-base shrink-0"
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
          disabled={(!text.trim() && !attachment) || isSending || uploading}
          isLoading={isSending || uploading}
          className="shrink-0"
        >
          Send
        </Button>
      </div>
    </form>
  )
}
