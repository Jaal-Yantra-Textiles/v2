/**
 * Chat history, shown in the route modal at /assistant/history.
 *
 * The assistant page no longer carries a sidebar: history lives here, opened
 * from the header, and the list is fetched fresh on every open so it reflects
 * conversations created or deleted anywhere since the page loaded. Selecting a
 * conversation calls back into the page (via AssistantPageContext) to load its
 * messages, then the modal closes — the page never unmounted, so the switch is
 * instant.
 */
import { useCallback, useEffect, useState } from "react"
import { Plus, Spinner, Trash } from "@medusajs/icons"
import { Badge, Button, Container, Text, toast } from "@medusajs/ui"
import { useRouteModal } from "@/components/modal/use-route-modal"
import {
  CONVERSATIONS_URL,
  apiFetch,
  useAssistantPage,
  type ConversationSummary,
} from "./assistant-page-context"

const HistoryList = () => {
  const { activeId, openConversation, deleteConversation, startNew } = useAssistantPage()
  const { handleSuccess } = useRouteModal()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { conversations } = await apiFetch<{ conversations: ConversationSummary[] }>(
          CONVERSATIONS_URL
        )
        if (!cancelled) setConversations(conversations)
      } catch {
        if (!cancelled) toast.error("Could not load your conversations.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const select = useCallback(
    (id: string) => {
      if (id !== activeId) openConversation(id)
      handleSuccess()
    },
    [activeId, openConversation, handleSuccess]
  )

  const remove = useCallback(
    async (id: string) => {
      const previous = conversations
      // Optimistic: the row disappearing is the confirmation the delete landed.
      setConversations((prev) => prev.filter((c) => c.id !== id))
      try {
        await deleteConversation(id)
      } catch {
        // The page already surfaced the failure; put the row back.
        setConversations(previous)
      }
    },
    [conversations, deleteConversation]
  )

  return (
    <div className="flex w-full flex-col gap-y-3">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Pick up a past conversation, or start a new one.
        </Text>
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            startNew()
            handleSuccess()
          }}
        >
          <Plus /> New chat
        </Button>
      </div>

      <Container className="p-0">
        {loading ? (
          <div className="text-ui-fg-muted flex items-center gap-2 px-6 py-6">
            <Spinner className="animate-spin" />
            <Text size="small">Loading…</Text>
          </div>
        ) : conversations.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted px-6 py-6">
            No conversations yet — they appear here after your first exchange.
          </Text>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-3 border-b px-6 py-3 last:border-b-0 ${
                c.id === activeId ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
              }`}
            >
              <button
                type="button"
                onClick={() => select(c.id)}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                title={c.title}
              >
                <span className="text-ui-fg-base w-full truncate text-sm">{c.title}</span>
                <span className="text-ui-fg-subtle text-xs">
                  {c.updated_at || c.created_at
                    ? new Date(c.updated_at || (c.created_at as string)).toLocaleString()
                    : ""}
                </span>
              </button>
              {c.id === activeId ? (
                <Badge size="2xsmall" color="green">
                  Current
                </Badge>
              ) : null}
              <button
                type="button"
                onClick={() => void remove(c.id)}
                className="text-ui-fg-muted hover:text-ui-fg-error opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Delete conversation"
              >
                <Trash className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </Container>
    </div>
  )
}

export const HistoryListModal = () => (
  <div className="flex w-full max-w-[720px] flex-col">
    <HistoryList />
  </div>
)
