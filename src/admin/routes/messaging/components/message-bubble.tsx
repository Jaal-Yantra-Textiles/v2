import { clx } from "@medusajs/ui"
import type { Message } from "../../../hooks/api/messaging"
import { ContextCard } from "./context-card"

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function statusIcon(status: string): string {
  switch (status) {
    case "sent": return "\u2713"
    case "delivered": return "\u2713\u2713"
    case "read": return "\u2713\u2713"
    case "failed": return "\u2717"
    default: return ""
  }
}

export const MessageBubble = ({ message }: { message: Message }) => {
  const isOutbound = message.direction === "outbound"

  return (
    <div className={clx("flex w-full mb-2", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={clx(
          "max-w-[70%] rounded-lg px-3 py-2 text-sm",
          isOutbound
            ? "bg-ui-bg-interactive text-ui-fg-on-color rounded-br-none"
            : "bg-ui-bg-subtle text-ui-fg-base rounded-bl-none"
        )}
      >
        {message.sender_name && (
          <div className={clx("text-xs font-medium mb-1", isOutbound ? "text-ui-fg-on-color/70" : "text-ui-fg-muted")}>
            {message.sender_name}
          </div>
        )}

        {message.context_snapshot && message.context_type && (
          <div className="mb-2">
            <ContextCard
              type={message.context_type}
              snapshot={message.context_snapshot}
            />
          </div>
        )}

        <div className="whitespace-pre-wrap break-words">{message.content}</div>

        <div className={clx("flex items-center gap-1 justify-end mt-1", isOutbound ? "text-ui-fg-on-color/60" : "text-ui-fg-muted")}>
          <span className="text-[10px]">{formatTime(message.created_at)}</span>
          {isOutbound && (
            <span className={clx("text-[10px]", message.status === "read" ? "text-blue-300" : "")}>
              {statusIcon(message.status)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
