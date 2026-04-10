import { useParams } from "react-router-dom"
import { Heading, Text, Badge, toast } from "@medusajs/ui"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { useConversationMessages, useSendMessage } from "../../../hooks/api/messaging"
import { useEffect, useRef } from "react"
import { MessageBubble } from "../components/message-bubble"
import { MessageInput } from "../components/message-input"

const ConversationThreadModal = () => {
  const { conversationId } = useParams<{ conversationId: string }>()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { conversation, messages = [], isPending } = useConversationMessages(
    conversationId!,
    { limit: 200 },
    { refetchInterval: 5000, enabled: !!conversationId }
  )

  const sendMutation = useSendMessage(conversationId!)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages?.length])

  const handleSend = (content: string) => {
    sendMutation.mutate(
      { content },
      {
        onError: (err: any) => {
          toast.error(err?.message || "Failed to send message. Check WhatsApp configuration.")
        },
      }
    )
  }

  return (
    <RouteFocusModal prev="/messaging">
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
        {isPending ? (
          <div className="flex items-center justify-center flex-1 text-ui-fg-muted">
            Loading messages...
          </div>
        ) : !conversation ? (
          <div className="flex items-center justify-center flex-1 text-ui-fg-muted">
            Conversation not found
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Conversation info bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-ui-border-base bg-ui-bg-base shrink-0">
              <div>
                <Heading level="h2">{conversation.partner_name}</Heading>
                <Text size="xsmall" className="text-ui-fg-muted">{conversation.phone_number}</Text>
              </div>
              <Badge color="green" size="2xsmall">{conversation.status}</Badge>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 bg-ui-bg-subtle">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-ui-fg-muted text-sm">
                  No messages yet. Send the first one below.
                </div>
              ) : (
                <div className="space-y-1 max-w-3xl mx-auto">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0">
              <MessageInput
                onSend={handleSend}
                isSending={sendMutation.isPending}
              />
            </div>
          </div>
        )}
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default ConversationThreadModal

export const handle = {
  breadcrumb: () => "Thread",
}
