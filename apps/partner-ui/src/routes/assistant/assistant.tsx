/**
 * Partner assistant page (#338 item 2) — dedicated `/assistant` route.
 *
 * Two-pane: a conversation-history sidebar (server-persisted) beside the live
 * chat thread. History survives reloads and follows the partner across devices;
 * the thread itself is stateless and driven by the Partner API via MCP tools.
 *
 * Responsive behaviour:
 *   - Desktop: the 260px history sidebar is collapsible (toggle in the
 *     header). When collapsed the chat thread takes the full width — handy
 *     for a fresh "New chat" where history isn't needed.
 *   - Mobile: the history sidebar is hidden behind a slide-over panel
 *     toggled by a menu button in the header, so the chat thread always has
 *     the full viewport width on small screens.
 */
import { useCallback, useEffect, useState } from "react"
import { Container, Heading, Text, Button, IconButton, toast } from "@medusajs/ui"
import { Sparkles, Plus, Trash, Spinner, SidebarLeft, BarsThree, XMark } from "@medusajs/icons"

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
  // Desktop: history sidebar visible by default, collapsible to give the chat
  // thread the full width (e.g. when starting a fresh "New chat").
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Mobile: history is a slide-over, closed by default.
  const [mobileOpen, setMobileOpen] = useState(false)

  const startNew = useCallback(() => {
    setActiveId(null)
    setInitialMessages([])
    setThreadKey((k) => k + 1)
    setMobileOpen(false)
  }, [])

  const openConversation = useCallback(
    async (id: string) => {
      if (id === activeId) {
        setMobileOpen(false)
        return
      }
      setOpening(true)
      try {
        const { conversation } = await sdk.client.fetch<{
          conversation: { id: string; messages: StoredMessage[] }
        }>(`/partners/assistant/conversations/${id}`, { method: "GET" })
        setActiveId(id)
        setInitialMessages(conversation.messages || [])
        setThreadKey((k) => k + 1)
        setMobileOpen(false)
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

  const onCompacted = useCallback(() => {
    // Refresh the history list so the title/stale state reflects compaction.
    setThreadKey((k) => k)
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

  // Close the mobile slide-over on Escape for a native-feeling dismiss.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileOpen])

  const historyPanel = (
    <HistoryPanel
      conversations={conversations}
      isPending={isPending}
      activeId={activeId}
      isMobile={false}
      onNew={startNew}
      onOpen={openConversation}
      onDelete={onDelete}
    />
  )

  return (
    <Container className="p-0 overflow-hidden h-[calc(100vh-90px)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base shrink-0">
        <div className="flex items-center gap-x-2">
          {/* Mobile: open history slide-over */}
          <IconButton
            variant="transparent"
            size="small"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Show conversations"
          >
            <BarsThree />
          </IconButton>
          <Sparkles className="text-ui-fg-subtle" />
          <Heading level="h2">Assistant</Heading>
        </div>
        {/* Desktop: collapse / expand the history sidebar */}
        <IconButton
          variant="transparent"
          size="small"
          className={`hidden lg:inline-flex ${sidebarOpen ? "rotate-180" : ""}`}
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
          title={sidebarOpen ? "Hide conversations" : "Show conversations"}
        >
          <SidebarLeft />
        </IconButton>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* History sidebar — desktop collapsible column */}
        {sidebarOpen && <div className="hidden lg:flex">{historyPanel}</div>}

        {/* Mobile history slide-over */}
        {mobileOpen && (
          <div className="lg:hidden">
            <div
              className="fixed inset-0 z-40 bg-ui-bg-overlay"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed left-0 top-0 bottom-0 z-50 w-[280px] max-w-[85vw] bg-ui-bg-base shadow-elevation-elevated flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 border-b border-ui-border-base shrink-0">
                <Text size="small" weight="plus">Conversations</Text>
                <IconButton
                  variant="transparent"
                  size="small"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close conversations"
                >
                  <XMark />
                </IconButton>
              </div>
              <HistoryPanel
                conversations={conversations}
                isPending={isPending}
                activeId={activeId}
                isMobile
                onNew={startNew}
                onOpen={openConversation}
                onDelete={onDelete}
              />
            </div>
          </div>
        )}

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
            onCompacted={onCompacted}
          />
        </div>
      </div>
    </Container>
  )
}

function HistoryPanel({
  conversations,
  isPending,
  activeId,
  isMobile,
  onNew,
  onOpen,
  onDelete,
}: {
  conversations: any[]
  isPending: boolean
  activeId: string | null
  isMobile: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string, e: React.MouseEvent) => void
}) {
  return (
    <div
      className={`${
        isMobile ? "flex-1 min-h-0" : "w-[260px]"
      } border-r border-ui-border-base flex flex-col shrink-0 min-h-0`}
    >
      <div className="p-2 shrink-0">
        <Button
          variant="secondary"
          size="small"
          className="w-full justify-center"
          onClick={onNew}
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
              onClick={() => onOpen(c.id)}
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
  )
}
