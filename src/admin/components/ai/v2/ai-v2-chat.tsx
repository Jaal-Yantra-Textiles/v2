import React from "react"
import { Button, Heading, Input, StatusBadge, Text, DropdownMenu, IconButton } from "@medusajs/ui"
import { BarsArrowDown } from "@medusajs/icons"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  useAiV2Chat,
  useAiV2ChatStream,
  useAiV2Resume,
  useAiV2RunFeedback,
  type AiV2Step,
} from "../../../hooks/api/ai-v2"
import { useMe } from "../../../hooks/api/users"
import { ChatComposer } from "./components/chat-composer"
import { StartChatPanel } from "./components/start-chat-panel"
import { ThreadSelect } from "./components/thread-select"
import { MessageList } from "./components/message-list"
import { RunDetailsPanel } from "./components/run-details-panel"
import { useAiV2ThreadControls } from "./hooks/use-ai-v2-thread-controls"
import { useAiV2StreamSync } from "./hooks/use-ai-v2-stream-sync"
import { createLocalId } from "./utils/message"
import type { UiMessage, AiV2RunStatus } from "./types"

const inferSuspendKind = (payload: any): "write" | "select" => {
  if (payload?.requires_confirmation) return "write"
  if (payload?.request) return "write"
  return "select"
}

const runStatusColor = (status: AiV2RunStatus): "green" | "orange" | "red" | "grey" => {
  if (status === "running") return "orange"
  if (status === "suspended") return "grey"
  if (status === "completed") return "green"
  if (status === "error") return "red"
  return "grey"
}

const runStatusLabel = (status: AiV2RunStatus) => {
  if (status === "running") return "Running"
  if (status === "suspended") return "Suspended"
  if (status === "completed") return "Completed"
  if (status === "error") return "Error"
  return "Idle"
}

export const AiV2Chat: React.FC = () => {
  const [params] = useSearchParams()
  const entity = params.get("entity") || undefined
  const entityId = params.get("entityId") || undefined

  const [messages, setMessages] = React.useState<UiMessage[]>([])
  const [input, setInput] = React.useState("")
  const [useStreaming, setUseStreaming] = React.useState(true)

  const defaultResourceId = entity ? `ai:v2:${entity}` : "ai:v2"

  const [lastSteps, setLastSteps] = React.useState<AiV2Step[] | undefined>(undefined)
  const [runDetailsOpen, setRunDetailsOpen] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  const [runId, setRunId] = React.useState<string | null>(null)
  const [runStatus, setRunStatus] = React.useState<AiV2RunStatus>("idle")

  const [feedbackRating, setFeedbackRating] = React.useState<"one" | "two" | "three" | "four" | "five">("five")
  const [feedbackComment, setFeedbackComment] = React.useState<string>("")
  const [feedbackSubmittedBy, setFeedbackSubmittedBy] = React.useState<string>("admin")
  const [feedbackSubmittedByTouched, setFeedbackSubmittedByTouched] = React.useState(false)
  const [feedbackSubmittedForRunId, setFeedbackSubmittedForRunId] = React.useState<string | null>(null)

  const [suspended, setSuspended] = React.useState<{
    runId: string
    payload: any
  } | null>(null)

  const chat = useAiV2Chat()
  const stream = useAiV2ChatStream()
  const resume = useAiV2Resume()
  const feedback = useAiV2RunFeedback()
  const me = useMe()

  const {
    threadPickerResource,
    setThreadPickerResource,
    availableThreads,
    selectedThreadId,
    setSelectedThreadId,
    activeThreadId,
    setActiveThreadId,
    activeResourceId,
    setActiveResourceId,
    hydrateFromThread,
    loadThreads,
    startNewChat,
    resetThreadContext,
    threadApi,
    threadsApi,
    createThreadApi,
  } = useAiV2ThreadControls({
    defaultResourceId,
    entity,
    onMessagesReset: (msgs) => setMessages(msgs),
    onInputReset: () => setInput(""),
    setLastSteps,
    setRunId,
    setRunStatus,
    setSuspended,
    setFeedbackSubmittedForRunId,
    stopStreaming: () => stream.stop(),
  })

  const openSelectedThread = React.useCallback(() => {
    if (!selectedThreadId) return
    hydrateFromThread(selectedThreadId, threadPickerResource)
  }, [selectedThreadId, hydrateFromThread, threadPickerResource])

  useAiV2StreamSync({
    stream,
    chatIsPending: chat.isPending,
    suspended,
    setSuspended,
    setMessages,
    setLastSteps,
    setActiveThreadId,
    setActiveResourceId,
    setThreadPickerResource,
    setRunId,
    setRunStatus,
    bottomRef,
    messageCount: messages.length,
  })

  React.useEffect(() => {
    if (!runId) return
    setFeedbackRating("five")
    setFeedbackComment("")
    setFeedbackSubmittedForRunId(null)
  }, [runId])

  React.useEffect(() => {
    if (feedbackSubmittedByTouched) return
    const email = (me as any)?.user?.email
    const id = (me as any)?.user?.id
    if (typeof email === "string" && email.trim()) {
      setFeedbackSubmittedBy(email)
      return
    }
    if (typeof id === "string" && id.trim()) {
      setFeedbackSubmittedBy(id)
    }
  }, [me, feedbackSubmittedByTouched])

  const canSend = input.trim().length > 0 && !chat.isPending && !stream.state.isStreaming

  const baseContext = React.useMemo(() => ({
    ui: "admin",
    entity,
    entity_id: entityId,
  }), [entity, entityId])

  const send = async () => {
    if (!canSend) return

    const threadId = activeThreadId || createLocalId()
    const resourceId =
      activeResourceId ||
      threadPickerResource ||
      (entity ? `ai:v2:${entity}` : "ai:v2")

    if (!activeThreadId) setActiveThreadId(threadId)
    if (!activeResourceId) setActiveResourceId(resourceId)

    const content = input.trim()
    setInput("")
    setMessages((m) => [...m, { id: createLocalId(), role: "user", content }])
    setRunStatus("running")

    if (useStreaming) {
      stream.start({
        message: content,
        threadId,
        resourceId,
        context: baseContext,
      })
      return
    }

    try {
      const resp = await chat.mutateAsync({
        message: content,
        threadId,
        resourceId,
        context: baseContext,
      })

      setRunId(resp.runId)

      if (resp.status === "suspended") {
        setSuspended({ runId: resp.runId, payload: resp.suspendPayload })
        setRunStatus("suspended")
        const reason = String(resp?.suspendPayload?.reason || "Action requires input")
        setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: reason }])
        return
      }

      const out = resp?.result
      if (out?.reply) {
        setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: out.reply || "" }])
      }
      if (Array.isArray(out?.steps)) setLastSteps(out.steps)
      if (out?.threadId && typeof out.threadId === "string") {
        setActiveThreadId(out.threadId)
      }
      if (out?.resourceId && typeof out.resourceId === "string") {
        setActiveResourceId(out.resourceId)
        setThreadPickerResource(out.resourceId)
      }
      setRunStatus("completed")
    } catch (e: any) {
      setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: e?.message || "Unexpected error" }])
      setRunStatus("error")
    }
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const handleConfirmWrite = async () => {
    if (!suspended) return
    const req = suspended.payload?.request
    if (!req) return

    try {
      setRunStatus("running")
      const resp = await resume.mutateAsync({
        runId: suspended.runId,
        step: "aiv2:run",
        resumeData: {
          confirmed: true,
          request: req,
          context: baseContext,
        },
      })

      setRunId(resp.runId)

      if (resp.status === "suspended") {
        setSuspended({ runId: resp.runId, payload: resp.suspendPayload })
        setRunStatus("suspended")
        return
      }

      setSuspended(null)
      const out = (resp as any).result
      if (out?.reply) {
        setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: out.reply || "" }])
      }
      if (Array.isArray(out?.steps)) setLastSteps(out.steps)
      setRunStatus("completed")
    } catch (e: any) {
      setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: e?.message || "Resume failed" }])
      setRunStatus("error")
    }
  }

  const handleCancelWrite = async () => {
    if (!suspended) return
    try {
      setRunStatus("running")
      await resume.mutateAsync({
        runId: suspended.runId,
        step: "aiv2:run",
        resumeData: {
          confirmed: false,
          context: baseContext,
        },
      })
    } catch {
      // ignore
    }
    setSuspended(null)
    setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: "Cancelled. No changes were made." }])
    setRunStatus("completed")
  }

  const handleSelect = async (selectedId: string, type: "option" | "action" = "option") => {
    if (!suspended) return

    try {
      setRunStatus("running")
      const resp = await resume.mutateAsync({
        runId: suspended.runId,
        step: "confirm-selection",
        resumeData: {
          selectedId: type === "option" ? selectedId : "",
          action: type === "action" ? selectedId : undefined,
          confirmed: true,
          context: baseContext,
        },
      })

      setRunId(resp.runId)

      if (resp.status === "suspended") {
        setSuspended({ runId: resp.runId, payload: resp.suspendPayload })
        setRunStatus("suspended")
        return
      }

      setSuspended(null)
      const out = (resp as any).result
      if (out?.reply) {
        setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: out.reply || "" }])
      }
      if (Array.isArray(out?.steps)) setLastSteps(out.steps)
      setRunStatus("completed")
    } catch (e: any) {
      setMessages((m) => [...m, { id: createLocalId(), role: "assistant", content: e?.message || "Resume failed" }])
      setRunStatus("error")
    }
  }

  const suspendedKind = suspended ? inferSuspendKind(suspended.payload) : null

  const canSubmitFeedback = Boolean(runId && runStatus === "completed" && feedbackSubmittedForRunId !== runId)

  const submitFeedback = async () => {
    if (!runId) return
    if (!canSubmitFeedback) return

    try {
      await feedback.mutateAsync({
        runId,
        payload: {
          rating: feedbackRating,
          comment: feedbackComment.trim() ? feedbackComment.trim() : undefined,
          status: "pending",
          submitted_by: feedbackSubmittedBy,
          submitted_at: new Date(),
          metadata: {
            threadId: activeThreadId,
            resourceId: activeResourceId,
            entity,
            entityId,
          },
        },
      })

      setFeedbackSubmittedForRunId(runId)
      toast.success("Feedback submitted")
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit feedback")
    }
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between pr-4">
          <Heading level="h2">AI v2 {entity ? `· ${entity}` : ""}</Heading>
          <div className="flex items-center gap-x-3">
            <StatusBadge color={runStatusColor(runStatus)}>{runStatusLabel(runStatus)}</StatusBadge>
            <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
              <input
                type="checkbox"
                checked={useStreaming}
                onChange={(e) => {
                  if (stream.state.isStreaming) return
                  setUseStreaming(e.target.checked)
                }}
              />
              Stream
            </label>
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex h-full flex-col overflow-hidden">
        {!activeThreadId && messages.length === 0 ? (
          <StartChatPanel
            threadPickerResource={threadPickerResource}
            onResourceChange={setThreadPickerResource}
            onLoadThreads={loadThreads}
            onStartNewChat={startNewChat}
            availableThreads={availableThreads}
            selectedThreadId={selectedThreadId}
            onSelectThread={setSelectedThreadId}
            onOpenThread={openSelectedThread}
            loadThreadsLoading={threadsApi.isPending}
            createThreadLoading={createThreadApi.isPending}
            openThreadLoading={threadApi.isPending}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden px-4 py-4">
            <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col overflow-hidden">
              <MessageList
                messages={messages}
                streamState={stream.state}
                chatIsPending={chat.isPending}
                suspended={suspended}
                suspendedKind={suspendedKind}
                acceptWrite={handleConfirmWrite}
                cancelWrite={handleCancelWrite}
                selectOption={handleSelect}
                resumeIsPending={resume.isPending}
                bottomRef={bottomRef}
              />

              <RunDetailsPanel
                open={runDetailsOpen}
                onOpenChange={setRunDetailsOpen}
                lastSteps={lastSteps}
                hideEmptySteps={messages.length > 0}
                runId={runId}
                runStatus={runStatus}
                feedbackRating={feedbackRating}
                onFeedbackRatingChange={(rating) => setFeedbackRating(rating)}
                feedbackComment={feedbackComment}
                onFeedbackCommentChange={setFeedbackComment}
                feedbackSubmittedBy={feedbackSubmittedBy}
                onFeedbackSubmittedByChange={(value) => {
                  setFeedbackSubmittedByTouched(true)
                  setFeedbackSubmittedBy(value)
                }}
                canSubmitFeedback={canSubmitFeedback}
                submitFeedback={submitFeedback}
                feedbackPending={feedback.isPending}
                feedbackSubmittedForRunId={feedbackSubmittedForRunId}
              />
            </div>
          </div>
        )}
        <div className="bg-ui-bg-base px-4 pb-6">
          {availableThreads.length ? (
            <div className="mx-auto mb-4 w-full max-w-[420px]">
              <ThreadSelect
                availableThreads={availableThreads}
                selectedThreadId={selectedThreadId}
                onSelect={setSelectedThreadId}
                onOpenSelected={openSelectedThread}
                isLoading={threadApi.isPending}
                areActionsDisabled={chat.isPending || stream.state.isStreaming}
                buttonFullWidth
              />
            </div>
          ) : null}

          <div className="mx-auto w-full max-w-[900px]">
            <ChatComposer
              value={input}
              onChange={setInput}
              disabled={chat.isPending || stream.state.isStreaming}
              canSend={canSend}
              isStreaming={stream.state.isStreaming}
              onStop={() => {
                stream.stop()
                setRunStatus("idle")
              }}
              onSend={send}
              onKeyDown={handleComposerKeyDown}
            />
          </div>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="text-ui-fg-subtle text-small">Resource ID</Text>
            <Input
              size="small"
              className="w-[220px]"
              value={threadPickerResource}
              onChange={(e) => setThreadPickerResource(e.target.value)}
              placeholder="ai:v2 or ai:v2:product"
              disabled={chat.isPending || stream.state.isStreaming}
            />
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <IconButton size="small" variant="transparent" disabled={chat.isPending || stream.state.isStreaming}>
                  <BarsArrowDown />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" sideOffset={4}>
                <DropdownMenu.Item
                  disabled={chat.isPending || stream.state.isStreaming}
                  onClick={loadThreads}
                >
                  Load chats
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={chat.isPending || stream.state.isStreaming}
                  onClick={startNewChat}
                >
                  New chat
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={chat.isPending || stream.state.isStreaming}
                  onClick={resetThreadContext}
                >
                  Change thread
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>

          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" type="button">
                Close
              </Button>
            </RouteFocusModal.Close>
          </div>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default AiV2Chat
