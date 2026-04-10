import { useState } from "react"
import { Button } from "@medusajs/ui"

export const MessageInput = ({
  onSend,
  isSending,
}: {
  onSend: (content: string) => void
  isSending: boolean
}) => {
  const [text, setText] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || isSending) return
    onSend(trimmed)
    setText("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-ui-border-base bg-ui-bg-base px-6 py-3"
    >
      <div className="flex items-end gap-3 w-full">
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
          disabled={!text.trim() || isSending}
          isLoading={isSending}
        >
          Send
        </Button>
      </div>
    </form>
  )
}
