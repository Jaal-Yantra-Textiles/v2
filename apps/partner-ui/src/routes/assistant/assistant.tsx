/**
 * Partner assistant page (#338 item 2) — dedicated `/assistant` route.
 *
 * Two-pane: a conversation-history sidebar (server-persisted) beside the live
 * chat thread. History survives reloads and follows the partner across devices;
 * the thread itself is stateless and driven by the Partner API via MCP tools.
 */
import { useCallback, useState } from "react"
import { Container, Heading, Text, Button, IconButton, toast } from "@medusajs/ui"
import { Sparkles, Plus, Trash, Spinner } from "@medusajs/icons"

import { sdk } from "../../lib/client"
import {
  usePartnerConversations,
  useDeleteConversation,
  type StoredMessage,
} from "../../hooks/api/assistant-conversations"
import { ChatThread } from "./components/chat-thread"

export const Assistant = () => {
  const { conversations, isPending } = usePartnerConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [threadKey, setThreadKey] = useState(0)
  const [initialMessages, setInitialMessages] = useState<StoredMessage[]>([])
  const [opening, setOpening] = useState(false)

  const startNew = useCallback(() => {
    setActiveId(null)
    setInitialMessages([])
    setThreadKey((k) => k + 1)
  }, [])

  const openConversation = useCallback(
    async (id: string) => {
      if (id === activeId) return
      setOpening(true)
      try {
        const { conversation } = await sdk.client.fetch<{
          conversation: { id: string; messages: StoredMessage[] }
        }>(`/partners/assistant/conversations/${id}`, { method: "GET" })
        setActiveId(id)
        setInitialMessages(conversation.messages || [])
        setThreadKey((k) => k + 1)
      } catch {
        toast.error("Could not open that conversation")
      } finally {
        setOpening(false)
      }
    },
    [activeId]
  )

  // A fresh chat was just saved — highlight it without remounting the thread.
  const onCreated = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const { mutate: deleteConversation } = useDeleteConversation()
  const onDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      deleteConversation(id, {
        onSuccess: () => {
          if (id === activeId) startNew()
        },
        onError: () => toast.error("Could not delete conversation"),
      })
    },
    [deleteConversation, activeId, startNew]
  )

  return (
    <Container className="p-0 overflow-hidden h-[calc(100vh-90px)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base shrink-0">
        <div className="flex items-center gap-x-2">
          <Sparkles className="text-ui-fg-subtle" />
          <Heading level="h2">Assistant</Heading>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* History sidebar */}
        <div className="w-[260px] border-r border-ui-border-base flex flex-col shrink-0 min-h-0">
          <div className="p-2 shrink-0">
            <Button
              variant="secondary"
              size="small"
              className="w-full justify-center"
              onClick={startNew}
            >
              <Plus />
              New chat
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-0.5">
            {isPending ? (
              <div className="flex justify-center py-6">
                <Spinner className="animate-spin text-ui-fg-muted" />
              </div>
            ) : !conversations?.length ? (
              <Text
                size="xsmall"
                className="text-ui-fg-muted text-center py-6 px-2"
              >
                No conversations yet. Start a new chat to begin.
              </Text>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`group w-full text-left rounded-md px-2.5 py-2 flex items-center gap-x-2 transition-colors ${
                    c.id === activeId
                      ? "bg-ui-bg-base-pressed"
                      : "hover:bg-ui-bg-base-hover"
                  }`}
                >
                  <Text
                    size="xsmall"
                    className="flex-1 truncate text-ui-fg-subtle"
                  >
                    {c.title}
                  </Text>
                  <IconButton
                    size="2xsmall"
                    variant="transparent"
                    className="opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => onDelete(c.id, e)}
                  >
                    <Trash className="text-ui-fg-muted" />
                  </IconButton>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat thread */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          {opening && (
            <div className="absolute inset-0 bg-ui-bg-base/60 flex items-center justify-center z-10">
              <Spinner className="animate-spin text-ui-fg-muted" />
            </div>
          )}
          <ChatThread
            key={threadKey}
            conversationId={activeId}
            initialMessages={initialMessages}
            onCreated={onCreated}
          />
        </div>
      </div>
    </Container>
  )
}
