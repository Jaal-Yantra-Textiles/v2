import { useEffect, useRef } from "react"
import { Text, Badge, IconButton, toast } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { useConversationMessages, useSendMessage } from "../../../hooks/api/messaging"
import { MessageBubble } from "./message-bubble"
import { MessageInput, type SendPayload } from "./message-input"

export const MessageThread = ({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  const { conversation, messages = [], isPending } = useConversationMessages(
    conversationId,
    { limit: 100 },
    { refetchInterval: 5000 }
  )

  const sendMutation = useSendMessage(conversationId)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages?.length, conversationId])

  const handleSend = (payload: SendPayload) => {
    sendMutation.mutate(
      payload,
      {
        onError: (err: any) => {
          toast.error(err?.message || "Failed to send message. Check WhatsApp configuration.")
        },
      }
    )
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-full text-ui-fg-muted bg-ui-bg-subtle">
        Loading messages...
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-ui-fg-muted bg-ui-bg-subtle">
        Conversation not found
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Conversation header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-ui-border-base bg-ui-bg-base">
        <div>
          <Text size="base" weight="plus">{conversation.partner_name}</Text>
          <Text size="xsmall" className="text-ui-fg-muted">{conversation.phone_number}</Text>
        </div>
        <div className="flex items-center gap-2">
          <Badge color="green" size="2xsmall">{conversation.status}</Badge>
          <IconButton size="small" variant="transparent" onClick={onClose}>
            <XMark />
          </IconButton>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 bg-ui-bg-subtle">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ui-fg-muted text-sm">
            No messages yet. Send the first one below.
          </div>
        ) : (
          <div className="space-y-1 max-w-full">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Full-width message input */}
      <MessageInput
        onSend={handleSend}
        isSending={sendMutation.isPending}
      />
    </div>
  )
}
