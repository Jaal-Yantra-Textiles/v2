import { useParams } from "react-router-dom"
import { Button, FocusModal, Heading, Input, Select, Text, Badge, toast } from "@medusajs/ui"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { useConversationMessages, useSendMessage } from "../../../hooks/api/messaging"
import { useEffect, useRef, useState } from "react"
import { MessageBubble } from "../components/message-bubble"
import { MessageInput, type SendPayload, type ReplyTo } from "../components/message-input"
import type { Message } from "../../../hooks/api/messaging"

const ConversationThreadModal = () => {
  const { conversationId } = useParams<{ conversationId: string }>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contextModal, setContextModal] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null)

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

  const handleReply = (message: Message) => {
    setReplyTo({
      id: message.id,
      content: message.content,
      sender_name: message.sender_name,
      direction: message.direction,
      media_url: message.media_url,
      media_mime_type: message.media_mime_type,
    })
  }

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

  const handleSendContext = (contextType: string, contextId: string, label: string) => {
    setContextModal(false)
    sendMutation.mutate(
      {
        content: `Sharing: ${label}`,
        context_type: contextType,
        context_id: contextId,
      },
      {
        onError: (err: any) => {
          toast.error(err?.message || "Failed to send")
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
                    <MessageBubble key={msg.id} message={msg} onReply={handleReply} />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0">
              <MessageInput
                onSend={handleSend}
                isSending={sendMutation.isPending}
                onAttachContext={() => setContextModal(true)}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
              />
            </div>
          </div>
        )}
      </RouteFocusModal.Body>

      {/* Context picker modal */}
      <ContextPickerModal
        open={contextModal}
        onClose={() => setContextModal(false)}
        onSelect={handleSendContext}
        partnerId={conversation?.partner_id}
      />
    </RouteFocusModal>
  )
}

export default ConversationThreadModal

export const handle = {
  breadcrumb: () => "Thread",
}

// ─── Context Picker Modal ────────────────────────────────────────────────────

const ContextPickerModal = ({
  open,
  onClose,
  onSelect,
  partnerId,
}: {
  open: boolean
  onClose: () => void
  onSelect: (contextType: string, contextId: string, label: string) => void
  partnerId?: string
}) => {
  const [contextType, setContextType] = useState<string>("design")
  const [contextId, setContextId] = useState("")
  const [items, setItems] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)

  const loadItems = async (type: string) => {
    setLoading(true)
    setItems([])
    setContextId("")
    try {
      const { sdk } = await import("../../../lib/config.js")
      if (type === "design") {
        const resp: any = await sdk.client.fetch("/admin/designs", {
          method: "GET",
          query: { limit: 50, fields: "id,name,status" },
        })
        setItems((resp.designs || []).map((d: any) => ({
          id: d.id,
          label: `${d.name || d.id} (${d.status})`,
        })))
      } else if (type === "production_run") {
        const resp: any = await sdk.client.fetch("/admin/production-runs", {
          method: "GET",
          query: { limit: 50 },
        })
        const runs = resp.production_runs || resp.data || []
        setItems(runs.map((r: any) => ({
          id: r.id,
          label: `${r.id} - ${r.status}`,
        })))
      }
    } catch (e: any) {
      console.error("Failed to load items:", e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadItems(contextType)
  }, [open, contextType])

  const selectedItem = items.find((i) => i.id === contextId)

  return (
    <FocusModal open={open} onOpenChange={(o) => !o && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title>Share with Partner</FocusModal.Title>
        </FocusModal.Header>
        <FocusModal.Body className="p-6 space-y-4">
          <div>
            <Text size="small" className="mb-1 font-medium block">Type</Text>
            <Select
              value={contextType}
              onValueChange={(v) => {
                setContextType(v)
                loadItems(v)
              }}
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="design">Design</Select.Item>
                <Select.Item value="production_run">Production Run</Select.Item>
              </Select.Content>
            </Select>
          </div>

          <div>
            <Text size="small" className="mb-1 font-medium block">
              Select {contextType === "design" ? "Design" : "Production Run"}
            </Text>
            {loading ? (
              <Text size="small" className="text-ui-fg-muted">Loading...</Text>
            ) : items.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">No items found</Text>
            ) : (
              <Select value={contextId} onValueChange={setContextId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select..." />
                </Select.Trigger>
                <Select.Content>
                  {items.map((item) => (
                    <Select.Item key={item.id} value={item.id}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="small" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={!contextId}
              onClick={() => {
                if (contextId && selectedItem) {
                  onSelect(contextType, contextId, selectedItem.label)
                }
              }}
            >
              Send
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
