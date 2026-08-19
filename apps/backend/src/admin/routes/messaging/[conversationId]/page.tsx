import { useParams } from "react-router-dom"
import {
  Button, Heading, Text, Badge, toast, Skeleton,
  DataTable, useDataTable,
  createDataTableFilterHelper, createDataTableColumnHelper, createDataTableCommandHelper,
  type DataTablePaginationState, type DataTableFilteringState,
} from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { StackedFocusModal } from "../../../components/modal/stacked-modal/stacked-focused-modal"
import { useConversationMessages, useSendMessage } from "../../../hooks/api/messaging"
import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { MessageBubble, MessageBubbleSkeleton, type MessageAction } from "../components/message-bubble"
import { MessageInput, type SendPayload, type ReplyTo } from "../components/message-input"
import { SenderPicker } from "../components/sender-picker"
import { CreatePaymentFromMessageModal } from "../components/create-payment-from-message-modal"
import { MessageRunActionModal, type MessageRunActionType } from "../components/message-run-action-modal"
import type { Message } from "../../../hooks/api/messaging"
import { type AdminDesign, useDesigns } from "../../../hooks/api/designs"
import type { AdminProductionRun } from "../../../hooks/api/production-runs"

const ConversationThreadModal = () => {
  const { conversationId } = useParams<{ conversationId: string }>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")

  // Single-modal-per-page pattern: the kebab on a bubble sets the active
  // action + message and opens the corresponding modal. Only one modal is
  // in the DOM at a time regardless of message count.
  const [activeAction, setActiveAction] = useState<{ type: MessageAction; message: Message } | null>(null)

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

  const handleMessageAction = (action: MessageAction, message: Message) => {
    setActiveAction({ type: action, message })
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

  const handleSendDesigns = (designs: AdminDesign[]) => {
    for (const design of designs) {
      sendMutation.mutate(
        {
          content: `Sharing: ${design.name || design.id} (${design.status})`,
          context_type: "design",
          context_id: design.id,
        },
        {
          onError: (err: any) => {
            toast.error(err?.message || `Failed to send ${design.name}`)
          },
        }
      )
    }
  }

  // After completing a run from the messaging inbox, send a short WhatsApp
  // summary back to the partner: "your current production run stands here".
  const handleRunCompleted = (run: AdminProductionRun) => {
    const lines = [
      `✅ *Production Run Completed*`,
      ``,
      `*Run ID:* ${run.id}`,
      `*Status:* Completed`,
    ]
    if (run.quantity) lines.push(`*Ordered:* ${run.quantity}`)
    if (run.produced_quantity != null) lines.push(`*Produced:* ${run.produced_quantity}`)
    if (run.rejected_quantity) lines.push(`*Rejected:* ${run.rejected_quantity}`)
    lines.push(``)
    lines.push(`Thank you for your work on this run. 🙏`)

    sendMutation.mutate(
      { content: lines.join("\n") },
      {
        onSuccess: () => toast.success("Summary sent to partner"),
        onError: (err: any) => toast.error(err?.message || "Failed to send summary — 24h window may be closed"),
      }
    )
  }

  const isRunAction = (type: MessageAction): type is MessageRunActionType =>
    type === "activity_note" || type === "attach_media" || type === "complete_run"

  return (
    <RouteFocusModal prev="/messaging">
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
        {isPending ? (
          <div className="flex flex-col h-full px-6 py-4 bg-ui-bg-subtle">
            {/* Header skeleton */}
            <div className="flex items-center justify-between px-0 py-3 border-b border-ui-border-base shrink-0">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-8 w-40" />
            </div>
            {/* Message skeletons */}
            <div className="flex-1 overflow-hidden py-4">
              <MessageBubbleSkeleton count={8} />
            </div>
            {/* Input skeleton */}
            <Skeleton className="h-16 w-full shrink-0" />
          </div>
        ) : !conversation ? (
          <div className="flex items-center justify-center flex-1 text-ui-fg-muted">
            Conversation not found
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Conversation info bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-ui-border-base bg-ui-bg-base shrink-0">
              <div className="flex-1 min-w-0">
                {editingTitle ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!titleDraft.trim()) return
                      try {
                        const { sdk: s } = await import("../../../lib/config.js")
                        await s.client.fetch(`/admin/messaging/${conversationId}/title`, {
                          method: "POST",
                          body: { title: titleDraft.trim() },
                        })
                        toast.success("Title updated")
                      } catch { /* ignore */ }
                      setEditingTitle(false)
                    }}
                  >
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => setEditingTitle(false)}
                      onKeyDown={(e) => e.key === "Escape" && setEditingTitle(false)}
                      className="text-lg font-medium bg-transparent border-b border-ui-border-interactive outline-none w-full"
                    />
                  </form>
                ) : (
                  <Heading
                    level="h2"
                    className="cursor-pointer hover:text-ui-fg-interactive transition-colors"
                    onClick={() => {
                      setTitleDraft(conversation.title || conversation.partner_name || "")
                      setEditingTitle(true)
                    }}
                  >
                    {conversation.title || conversation.partner_name}
                  </Heading>
                )}
                <Text size="xsmall" className="text-ui-fg-muted">{conversation.phone_number}</Text>
              </div>
              <div className="flex items-center gap-x-3 shrink-0">
                <SenderPicker
                  conversationId={conversationId!}
                  currentPlatformId={conversation.default_sender_platform_id ?? null}
                  recipientPhone={conversation.phone_number}
                />
                <Badge color="green" size="2xsmall">{conversation.status}</Badge>
              </div>
            </div>

            {/* Awaiting reply banner */}
            {conversation.metadata?.awaiting_reply && (
              <div className="flex items-center gap-2 px-6 py-2 bg-ui-bg-highlight border-b border-ui-border-base text-sm text-ui-fg-muted">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                <Text size="small">
                  Waiting for partner to reply. Messages are queued and will be sent automatically once they respond.
                </Text>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 bg-ui-bg-subtle">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-ui-fg-muted text-sm">
                  No messages yet. Send the first one below.
                </div>
              ) : (
                <div className="space-y-1 max-w-3xl mx-auto">
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onReply={handleReply}
                      onMessageAction={handleMessageAction}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Input + Share Designs */}
            <div className="shrink-0">
              <MessageInput
                onSend={handleSend}
                isSending={sendMutation.isPending}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
              />
            </div>
            <ShareDesignsStacked onSend={handleSendDesigns} />
          </div>
        )}
      </RouteFocusModal.Body>

      {/* Payment modal */}
      {conversation && (
        <CreatePaymentFromMessageModal
          open={!!activeAction && activeAction.type === "payment"}
          onClose={() => setActiveAction(null)}
          message={activeAction?.type === "payment" ? activeAction.message : null}
          partnerId={conversation.partner_id}
          partnerName={conversation.partner_name}
        />
      )}

      {/* Run action modal (activity note / attach media / complete run) */}
      {conversation && (
        <MessageRunActionModal
          open={!!activeAction && isRunAction(activeAction.type)}
          onClose={() => setActiveAction(null)}
          actionType={activeAction && isRunAction(activeAction.type) ? activeAction.type : "activity_note"}
          message={activeAction && isRunAction(activeAction.type) ? activeAction.message : null}
          partnerId={conversation.partner_id}
          partnerName={conversation.partner_name}
          conversationId={conversationId!}
          onRunCompleted={handleRunCompleted}
        />
      )}
    </RouteFocusModal>
  )
}

export default ConversationThreadModal

export const handle = {
  breadcrumb: () => "Thread",
}

// ─── Share Designs (Stacked Modal + DataTable + CommandBar) ─────────────────

const designColumnHelper = createDataTableColumnHelper<AdminDesign>()
const designFilterHelper = createDataTableFilterHelper<AdminDesign>()
const designCommandHelper = createDataTableCommandHelper()

const designFilters = [
  designFilterHelper.accessor("status", {
    type: "select",
    label: "Status",
    options: [
      { label: "Conceptual", value: "Conceptual" },
      { label: "In Development", value: "In_Development" },
      { label: "Technical Review", value: "Technical_Review" },
      { label: "Sample Production", value: "Sample_Production" },
      { label: "Approved", value: "Approved" },
      { label: "Commerce Ready", value: "Commerce_Ready" },
      { label: "Revision", value: "Revision" },
      { label: "Rejected", value: "Rejected" },
    ],
  }),
  designFilterHelper.accessor("design_type", {
    type: "select",
    label: "Type",
    options: [
      { label: "Fabric", value: "Fabric" },
      { label: "Pattern", value: "Pattern" },
      { label: "Garment", value: "Garment" },
      { label: "Accessory", value: "Accessory" },
    ],
  }),
  designFilterHelper.accessor("priority", {
    type: "select",
    label: "Priority",
    options: [
      { label: "High", value: "High" },
      { label: "Medium", value: "Medium" },
      { label: "Low", value: "Low" },
    ],
  }),
]

const designColumns = [
  designColumnHelper.select(),
  designColumnHelper.accessor("name", {
    header: "Name",
    cell: ({ getValue }) => <div className="font-medium">{getValue()}</div>,
  }),
  designColumnHelper.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => {
      const s = getValue()
      if (!s) return null
      const colors: Record<string, "green" | "orange" | "blue" | "grey" | "red"> = {
        Approved: "green", Commerce_Ready: "green", In_Development: "orange",
        Technical_Review: "blue", Sample_Production: "blue", Conceptual: "grey",
        Revision: "orange", Rejected: "red", On_Hold: "grey", Superseded: "grey",
      }
      return <Badge color={colors[s] || "grey"} size="2xsmall">{s.replace(/_/g, " ")}</Badge>
    },
  }),
  designColumnHelper.accessor("design_type", {
    header: "Type",
    cell: ({ getValue }) => {
      const t = getValue()
      return t ? <Badge size="2xsmall">{t}</Badge> : null
    },
  }),
  designColumnHelper.accessor("priority", {
    header: "Priority",
    cell: ({ getValue }) => {
      const p = getValue()
      if (!p) return null
      const c: Record<string, "red" | "orange" | "green" | "grey"> = { High: "red", Medium: "orange", Low: "green" }
      return <Badge color={c[p] || "grey"} size="2xsmall">{p}</Badge>
    },
  }),
]

const ShareDesignsStacked = ({ onSend }: { onSend: (designs: AdminDesign[]) => void }) => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [])

  const serverFilters = useMemo(() => {
    const f: Record<string, any> = {}
    if (filtering["status"]) f.status = filtering["status"]
    if (filtering["design_type"]) f.design_type = filtering["design_type"]
    if (filtering["priority"]) f.priority = filtering["priority"]
    return f
  }, [filtering])

  const { designs, count = 0, isLoading } = useDesigns({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    q: search || undefined,
    ...serverFilters,
  })

  const data = useMemo(() => (designs || []) as AdminDesign[], [designs])

  const sendSelected = useCallback(async (selection: Record<string, boolean>) => {
    const selectedDesigns = data.filter((d) => selection[d.id])
    if (selectedDesigns.length > 0) {
      onSend(selectedDesigns)
      setRowSelection({})
    }
  }, [data, onSend])

  const commands = useMemo(() => [
    designCommandHelper.command({
      label: "Send to Partner",
      shortcut: "s",
      action: sendSelected,
    }),
  ], [sendSelected])

  const table = useDataTable({
    columns: designColumns,
    data,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    filters: designFilters,
    commands,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: (next) => {
        setFiltering(next)
        setPagination((p) => ({ ...p, pageIndex: 0 }))
      },
    },
  })

  return (
    <StackedFocusModal id="share-designs-modal">
      <StackedFocusModal.Trigger asChild>
        <Button variant="secondary" size="small" className="mx-6 mb-3">
          <PencilSquare className="mr-1.5" />
          Share Designs
        </Button>
      </StackedFocusModal.Trigger>
      <StackedFocusModal.Content className="flex flex-col overflow-hidden">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Share Designs with Partner</StackedFocusModal.Title>
        </StackedFocusModal.Header>
        <StackedFocusModal.Body className="flex flex-col overflow-hidden p-0">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
              <Heading level="h2">Designs</Heading>
              <div className="flex items-center gap-x-2">
                <DataTable.Search placeholder="Search designs..." />
                <DataTable.FilterMenu tooltip="Filter designs" />
              </div>
            </DataTable.Toolbar>
            <DataTable.Table />
            <DataTable.Pagination />
            <DataTable.CommandBar selectedLabel={(count) => `${count} selected`} />
          </DataTable>
        </StackedFocusModal.Body>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}
