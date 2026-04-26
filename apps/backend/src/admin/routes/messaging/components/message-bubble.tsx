import { clx } from "@medusajs/ui"
import type { Message } from "../../../hooks/api/messaging"
import { ContextCard } from "./context-card"

const URL_REGEX = /(https?:\/\/[^\s]+)/g

/**
 * Renders message content with URLs as clickable links + preview cards.
 */
const RichContent = ({ text, isOutbound }: { text: string; isOutbound: boolean }) => {
  const parts = text.split(URL_REGEX)
  const urls = text.match(URL_REGEX) || []

  return (
    <div>
      {/* URL preview cards */}
      {urls.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-1.5">
          {urls.map((url, i) => {
            // Try to extract domain and path for a simple preview
            let domain = ""
            let path = ""
            try {
              const parsed = new URL(url)
              domain = parsed.hostname.replace("www.", "")
              path = parsed.pathname.length > 1 ? parsed.pathname : ""
            } catch { domain = url }

            const isImage = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url)

            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={clx(
                  "block rounded-md overflow-hidden border transition-colors",
                  isOutbound
                    ? "border-white/20 hover:border-white/40"
                    : "border-ui-border-base hover:border-ui-border-strong"
                )}
              >
                {isImage && (
                  <img src={url} alt="" className="w-full max-h-40 object-cover" />
                )}
                <div className={clx(
                  "px-2.5 py-1.5 text-xs",
                  isOutbound ? "bg-white/10" : "bg-ui-bg-base"
                )}>
                  <div className={clx(
                    "font-medium truncate",
                    isOutbound ? "text-ui-fg-on-color" : "text-ui-fg-base"
                  )}>
                    {domain}
                  </div>
                  {path && (
                    <div className={clx(
                      "truncate",
                      isOutbound ? "text-ui-fg-on-color/60" : "text-ui-fg-muted"
                    )}>
                      {path}
                    </div>
                  )}
                </div>
              </a>
            )
          })}
        </div>
      )}

      {/* Text with inline links */}
      <div className="whitespace-pre-wrap break-words">
        {parts.map((part, i) =>
          URL_REGEX.test(part) ? (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={clx(
                "underline break-all",
                isOutbound ? "text-blue-200 hover:text-blue-100" : "text-ui-fg-interactive hover:underline"
              )}
            >
              {part}
            </a>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </div>
    </div>
  )
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function statusIcon(status: string): string {
  switch (status) {
    case "queued": return "\u23F3"    // hourglass
    case "sent": return "\u2713"
    case "delivered": return "\u2713\u2713"
    case "read": return "\u2713\u2713"
    case "failed": return "\u2717"
    default: return ""
  }
}

function isImageMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith("image/")
}

function isVideoMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith("video/")
}

const MediaPreview = ({ message }: { message: Message }) => {
  if (!message.media_url) return null

  const filename = (message.metadata as any)?.filename || message.media_url.split("/").pop() || "file"
  const isOutbound = message.direction === "outbound"

  if (isImageMime(message.media_mime_type)) {
    return (
      <a href={message.media_url} target="_blank" rel="noopener noreferrer" className="block mb-1">
        <img
          src={message.media_url}
          alt={filename}
          className="max-w-full rounded-md max-h-48 object-cover"
        />
      </a>
    )
  }

  if (isVideoMime(message.media_mime_type)) {
    return (
      <video
        src={message.media_url}
        controls
        className="max-w-full rounded-md max-h-48"
      />
    )
  }

  // Document / other file
  return (
    <a
      href={message.media_url}
      target="_blank"
      rel="noopener noreferrer"
      className={clx(
        "flex items-center gap-2 rounded-md border px-3 py-2 mb-1 text-xs transition-colors",
        isOutbound
          ? "border-white/20 hover:bg-white/10"
          : "border-ui-border-base hover:bg-ui-bg-base-hover"
      )}
    >
      <span>📄</span>
      <span className="truncate">{filename}</span>
    </a>
  )
}

const ReplyPreview = ({ snapshot, isOutbound }: { snapshot: Message["reply_to_snapshot"]; isOutbound: boolean }) => {
  if (!snapshot) return null

  const isReplyFromPartner = snapshot.direction === "inbound"

  return (
    <div
      className={clx(
        "rounded-md px-2.5 py-1.5 mb-1.5 border-l-2 text-xs",
        isOutbound
          ? "bg-white/10 border-white/40"
          : "bg-ui-bg-base border-ui-border-interactive"
      )}
    >
      <div className={clx("font-medium mb-0.5", isOutbound ? "text-ui-fg-on-color/80" : "text-ui-fg-interactive")}>
        {snapshot.sender_name || (isReplyFromPartner ? "Partner" : "Admin")}
      </div>
      {snapshot.media_url && snapshot.media_mime_type?.startsWith("image/") && (
        <img src={snapshot.media_url} alt="" className="h-8 w-8 rounded object-cover inline-block mr-1" />
      )}
      <span className={clx(isOutbound ? "text-ui-fg-on-color/60" : "text-ui-fg-muted")}>
        {snapshot.content || (snapshot.media_url ? "Media" : "")}
      </span>
    </div>
  )
}

export const MessageBubble = ({
  message,
  onReply,
}: {
  message: Message
  onReply?: (message: Message) => void
}) => {
  const isOutbound = message.direction === "outbound"

  return (
    <div
      className={clx("group flex w-full mb-2 items-start gap-1", isOutbound ? "justify-end" : "justify-start")}
    >
      {/* Reply button (left side for outbound) */}
      {isOutbound && onReply && (
        <button
          onClick={() => onReply(message)}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 text-ui-fg-muted hover:text-ui-fg-base"
          title="Reply"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 scale-x-[-1]">
            <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" />
          </svg>
        </button>
      )}

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

        <ReplyPreview snapshot={message.reply_to_snapshot} isOutbound={isOutbound} />

        {message.context_snapshot && message.context_type && (
          <div className="mb-2">
            <ContextCard
              type={message.context_type}
              snapshot={message.context_snapshot}
            />
          </div>
        )}

        <MediaPreview message={message} />

        {message.content && message.content.trim() && (
          <RichContent text={message.content} isOutbound={isOutbound} />
        )}

        <div className={clx("flex items-center gap-1 justify-end mt-1", isOutbound ? "text-ui-fg-on-color/60" : "text-ui-fg-muted")}>
          <span className="text-[10px]">{formatTime(message.created_at)}</span>
          {isOutbound && (
            <span className={clx(
              "text-[10px]",
              message.status === "read" ? "text-blue-300" :
              message.status === "queued" ? "text-orange-300" :
              message.status === "failed" ? "text-red-300" : ""
            )}>
              {statusIcon(message.status)}
            </span>
          )}
        </div>
      </div>

      {/* Reply button (right side for inbound) */}
      {!isOutbound && onReply && (
        <button
          onClick={() => onReply(message)}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 text-ui-fg-muted hover:text-ui-fg-base"
          title="Reply"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  )
}
