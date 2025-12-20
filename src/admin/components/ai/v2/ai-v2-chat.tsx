import React from "react"
import { Button, Heading, Input, StatusBadge, Text, Textarea, Select } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  useAiV2Chat,
  useAiV2ChatStream,
  useAiV2Resume,
  useAiV2RunFeedback,
  type AiV2Step,
  type AiV2WorkflowOutput,
} from "../../../hooks/api/ai-v2"
import { useMe } from "../../../hooks/api/users"
import { useChatThread, useChatThreads, useCreateChatThread } from "../../../hooks/api/ai"
import { MarkdownMessage } from "./components/markdown-message"
import { StepTimeline } from "./components/step-timeline"
import { WriteConfirmCard } from "./components/write-confirm-card"
import { SuspendedWorkflowSelector } from "../chat/suspended-workflow-selector"

type UiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

const bubbleClass = (role: UiMessage["role"]) =>
  role === "user"
    ? "ml-auto bg-ui-bg-base border border-ui-border-base"
    : "mr-auto bg-ui-bg-subtle"

const createLocalId = () => {
  return typeof crypto !== "undefined" && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const inferSuspendKind = (payload: any): "write" | "select" => {
  if (payload?.requires_confirmation) return "write"
  if (payload?.request) return "write"
  return "select"
}

type AiV2RunStatus = "idle" | "running" | "suspended" | "completed" | "error"

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

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null)
  const [activeResourceId, setActiveResourceId] = React.useState<string | null>(null)
  const [threadPickerResource, setThreadPickerResource] = React.useState<string>(
    entity ? `ai:v2:${entity}` : "ai:v2"
  )
  const [availableThreads, setAvailableThreads] = React.useState<any[]>([])
  const [selectedThreadId, setSelectedThreadId] = React.useState<string>("")

  const [lastSteps, setLastSteps] = React.useState<AiV2Step[] | undefined>(undefined)

  const bottomRef = React.useRef<HTMLDivElement>(null)

  const chat = useAiV2Chat()
  const stream = useAiV2ChatStream()
  const resume = useAiV2Resume()
  const feedback = useAiV2RunFeedback()
  const me = useMe()

  const threadsApi = useChatThreads()
  const threadApi = useChatThread()
  const createThreadApi = useCreateChatThread()

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

  React.useEffect(() => {
    if (stream.state.final) {
      const out = stream.state.final as AiV2WorkflowOutput
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
    }
  }, [stream.state.final])

  React.useEffect(() => {
    if (stream.state.runId) setRunId(stream.state.runId)
  }, [stream.state.runId])

  React.useEffect(() => {
    if (stream.state.isStreaming || stream.state.active) {
      setRunStatus("running")
    }
  }, [stream.state.isStreaming, stream.state.active])

  React.useEffect(() => {
    if (stream.state.final) setRunStatus("completed")
  }, [stream.state.final])

  React.useEffect(() => {
    if (stream.state.error) setRunStatus("error")
  }, [stream.state.error])

  React.useEffect(() => {
    if (stream.state.isStreaming) return
    if (stream.state.active) return
    if (stream.state.error) return
    if (stream.state.final) return
    if (suspended) return
    if (chat.isPending) return
    if (runStatus === "running") setRunStatus("idle")
  }, [
    stream.state.isStreaming,
    stream.state.active,
    stream.state.error,
    stream.state.final,
    suspended,
    chat.isPending,
    runStatus,
  ])

  React.useEffect(() => {
    if (!bottomRef.current) return
    bottomRef.current.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, suspended?.runId, stream.state.isStreaming, stream.state.active, stream.state.liveText])

  React.useEffect(() => {
    if (Array.isArray(stream.state.steps) && stream.state.steps.length) {
      setLastSteps(stream.state.steps)
    }
  }, [stream.state.steps])

  React.useEffect(() => {
    if (stream.state.suspended) {
      setSuspended({ runId: stream.state.suspended.runId, payload: stream.state.suspended.suspendPayload })
      if (stream.state.suspended.runId) setRunId(stream.state.suspended.runId)
      setRunStatus("suspended")
    }
  }, [stream.state.suspended])

  React.useEffect(() => {
    if (!runId) return
    setFeedbackRating("five")
    setFeedbackComment("")
    setFeedbackSubmittedForRunId(null)
  }, [runId])

  const uiMessageToText = React.useCallback((content: any): string => {
    if (typeof content === "string") return content
    if (content == null) return ""
    if (Array.isArray(content)) {
      const parts = content
        .map((p) => {
          if (typeof p === "string") return p
          if (p && typeof p === "object") {
            if (typeof (p as any).text === "string") return (p as any).text
            if (typeof (p as any).content === "string") return (p as any).content
          }
          return ""
        })
        .filter(Boolean)
      if (parts.length) return parts.join("")
    }
    if (typeof content === "object") {
      if (typeof (content as any).text === "string") return (content as any).text
      if (typeof (content as any).content === "string") return (content as any).content
      if (typeof (content as any).message === "string") return (content as any).message
    }
    try {
      return JSON.stringify(content, null, 2)
    } catch {
      return String(content)
    }
  }, [])

  const hydrateFromThread = React.useCallback(
    async (nextThreadId: string, resourceId?: string) => {
      const rid = (resourceId || threadPickerResource || "ai:v2").trim()
      if (!nextThreadId) return

      const resp = await threadApi.mutateAsync({ threadId: nextThreadId, resourceId: rid, page: 0, perPage: 200 })
      const ui = Array.isArray((resp as any)?.uiMessages) ? (resp as any).uiMessages : []
      const mapped: UiMessage[] = ui
        .map((m: any) => {
          const role = m?.role === "user" || m?.role === "assistant" ? m.role : undefined
          if (!role) return null
          return {
            id: typeof m?.id === "string" && m.id ? m.id : createLocalId(),
            role,
            content: uiMessageToText(m?.content),
          } as UiMessage
        })
        .filter(Boolean) as UiMessage[]

      const threadResource = String((resp as any)?.thread?.resourceId || rid)
      setActiveResourceId(threadResource)
      setThreadPickerResource(threadResource)
      setActiveThreadId(nextThreadId)
      setMessages(mapped)
      setInput("")

      setLastSteps(undefined)
      setRunId(null)
      setRunStatus("idle")
      setSuspended(null)
      setFeedbackSubmittedForRunId(null)
    },
    [threadApi, threadPickerResource, uiMessageToText]
  )

  const loadThreads = React.useCallback(async () => {
    const rid = threadPickerResource.trim()
    if (!rid) return
    const resp = await threadsApi.mutateAsync({ resourceId: rid, page: 0, perPage: 50 })
    const threads = Array.isArray((resp as any)?.threads) ? (resp as any).threads : []
    setAvailableThreads(threads)
    if (!selectedThreadId && threads.length) {
      setSelectedThreadId(String(threads[0]?.id || ""))
    }
  }, [threadsApi, threadPickerResource, selectedThreadId])

  const startNewChat = React.useCallback(async () => {
    const rid = threadPickerResource.trim() || (entity ? `ai:v2:${entity}` : "ai:v2")
    let tid: string | null = null
    try {
      const created = await createThreadApi.mutateAsync({ resourceId: rid })
      tid = String((created as any)?.thread?.id || "")
    } catch {
      tid = createLocalId()
    }

    setActiveResourceId(rid)
    setActiveThreadId(tid || createLocalId())
    setMessages([])
    setInput("")
    setLastSteps(undefined)
    setRunId(null)
    setRunStatus("idle")
    setSuspended(null)
    setFeedbackSubmittedForRunId(null)
  }, [createThreadApi, entity, threadPickerResource])

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
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex items-center justify-center px-4 py-8">
              <div className="w-full max-w-[640px] border border-ui-border-base rounded-lg p-4 bg-ui-bg-base">
                <Heading level="h2">Start a chat</Heading>
                <Text className="text-ui-fg-subtle text-small mt-1">
                  Select a previous thread (by resource) or create a new chat.
                </Text>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <div>
                    <Text className="text-ui-fg-subtle text-small">Resource ID</Text>
                    <Input
                      value={threadPickerResource}
                      onChange={(e) => setThreadPickerResource(e.target.value)}
                      placeholder="ai:v2 or ai:v2:product"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      type="button"
                      isLoading={threadsApi.isPending}
                      onClick={loadThreads}
                    >
                      Load chats
                    </Button>
                    <Button
                      type="button"
                      isLoading={createThreadApi.isPending}
                      onClick={startNewChat}
                    >
                      New chat
                    </Button>
                  </div>

                  {availableThreads.length ? (
                    <div className="mt-2">
                      <Text className="text-ui-fg-subtle text-small mb-1">Existing threads</Text>
                      <Select value={selectedThreadId} onValueChange={setSelectedThreadId}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select a thread…" />
                        </Select.Trigger>
                        <Select.Content>
                          {availableThreads.map((t: any) => (
                            <Select.Item key={String(t.id)} value={String(t.id)}>
                              {t.title ? `${t.title} · ` : ""}{String(t.id)}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                      <div className="mt-2">
                        <Button
                          variant="secondary"
                          type="button"
                          isLoading={threadApi.isPending}
                          disabled={!selectedThreadId}
                          onClick={() => hydrateFromThread(selectedThreadId, threadPickerResource)}
                        >
                          Open selected
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <Text className="text-ui-fg-subtle text-small">
                    You can also just type a message below and hit Send — a new thread will be created automatically.
                  </Text>
                </div>
              </div>
            </div>

            <div className="mt-auto border-t border-ui-border-base bg-ui-bg-base">
              <div className="mx-auto w-full max-w-[1200px] px-3 py-3">
                <div className="group w-full max-w-[900px] rounded-2xl border border-ui-border-base bg-ui-bg-base shadow-sm">
                  <div className="p-3">
                    <Textarea
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask something… e.g. list all products, update partner name…"
                      disabled={chat.isPending || stream.state.isStreaming}
                      className="resize-none border-none bg-transparent p-0 outline-none focus:outline-none focus:ring-0 min-h-[44px]"
                    />

                    <div className="mt-2 flex items-center justify-end gap-2">
                      {stream.state.isStreaming ? (
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => {
                            stream.stop()
                            setRunStatus("idle")
                          }}
                          size="small"
                        >
                          Stop
                        </Button>
                      ) : null}
                      <Button type="button" isLoading={chat.isPending} disabled={!canSend} onClick={send} size="small">
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden px-4 py-4">
            <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col overflow-hidden">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="w-full sm:max-w-[520px]">
                  <Text className="text-ui-fg-subtle text-small">Resource ID</Text>
                  <Input
                    value={threadPickerResource}
                    onChange={(e) => setThreadPickerResource(e.target.value)}
                    placeholder="ai:v2 or ai:v2:product"
                    disabled={chat.isPending || stream.state.isStreaming}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    size="small"
                    isLoading={threadsApi.isPending}
                    onClick={loadThreads}
                    disabled={chat.isPending || stream.state.isStreaming}
                  >
                    Load chats
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    size="small"
                    isLoading={createThreadApi.isPending}
                    onClick={startNewChat}
                    disabled={chat.isPending || stream.state.isStreaming}
                  >
                    New chat
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    size="small"
                    onClick={() => {
                      stream.stop()
                      setRunStatus("idle")
                      setActiveThreadId(null)
                      setActiveResourceId(null)
                      setAvailableThreads([])
                      setSelectedThreadId("")
                      setMessages([])
                      setLastSteps(undefined)
                      setRunId(null)
                      setSuspended(null)
                      setFeedbackSubmittedForRunId(null)
                    }}
                    disabled={chat.isPending || stream.state.isStreaming}
                  >
                    Change thread
                  </Button>
                </div>
              </div>

              {availableThreads.length ? (
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="w-full sm:max-w-[520px]">
                    <Select value={selectedThreadId} onValueChange={setSelectedThreadId}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select a thread…" />
                      </Select.Trigger>
                      <Select.Content>
                        {availableThreads.map((t: any) => (
                          <Select.Item key={String(t.id)} value={String(t.id)}>
                            {t.title ? `${t.title} · ` : ""}{String(t.id)}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <Button
                    variant="secondary"
                    type="button"
                    size="small"
                    isLoading={threadApi.isPending}
                    disabled={!selectedThreadId || chat.isPending || stream.state.isStreaming}
                    onClick={() => hydrateFromThread(selectedThreadId, threadPickerResource)}
                  >
                    Open selected
                  </Button>
                </div>
              ) : null}

              <div className="flex-1 overflow-y-auto pr-1">
                <div className="flex flex-col gap-y-3 pb-6">
                  {messages.length === 0 && (chat.isPending || stream.state.isStreaming || stream.state.active) ? (
                    <div className="flex w-full items-center justify-center gap-2 py-10 text-ui-fg-subtle">
                      <Spinner className="animate-spin" />
                      <span className="text-small">{stream.state.active || "Thinking..."}</span>
                    </div>
                  ) : null}

                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass(m.role)} animate-in fade-in slide-in-from-bottom-1 duration-200`}
                    >
                      <Text className="text-ui-fg-subtle text-small block mb-1">
                        {m.role === "user" ? "You" : "Assistant"}
                      </Text>
                      <div className="whitespace-pre-wrap break-words">
                        {m.role === "assistant" ? <MarkdownMessage value={m.content} /> : m.content}
                      </div>
                    </div>
                  ))}

                  {stream.state.isStreaming && stream.state.liveText ? (
                    <div className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass("assistant")} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                      <Text className="text-ui-fg-subtle text-small block mb-1">Assistant (draft)</Text>
                      <div className="whitespace-pre-wrap break-words">
                        <MarkdownMessage value={stream.state.liveText} />
                      </div>
                    </div>
                  ) : null}

                  {suspended && suspendedKind === "write" ? (
                    <div className="max-w-[92%]">
                      <WriteConfirmCard
                        payload={suspended.payload}
                        isLoading={resume.isPending}
                        onConfirm={handleConfirmWrite}
                        onCancel={handleCancelWrite}
                      />
                    </div>
                  ) : null}

                  {suspended && suspendedKind === "select" ? (
                    <div className="max-w-[92%]">
                      <SuspendedWorkflowSelector
                        reason={String(suspended.payload?.reason || "Please select an option")}
                        options={Array.isArray(suspended.payload?.options) ? suspended.payload.options : []}
                        actions={Array.isArray(suspended.payload?.actions) ? suspended.payload.actions : undefined}
                        onSelect={handleSelect}
                        isLoading={resume.isPending}
                      />
                    </div>
                  ) : null}

                  {(chat.isPending || stream.state.isStreaming || stream.state.active) && messages.length ? (
                    <div className={`flex w-full ${bubbleClass("assistant")}`}>
                      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl rounded-tl-none bg-ui-bg-subtle text-ui-fg-subtle">
                        <Spinner className="animate-spin" />
                        <span className="text-small">{stream.state.active || "Thinking..."}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="w-full sm:w-[420px]">
                      <StepTimeline steps={lastSteps} hideEmpty={messages.length > 0} />
                    </div>

                    {runId && runStatus === "completed" ? (
                      <div className={`w-full sm:w-[420px] rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 ${bubbleClass("assistant")}`}>
                        <div className="flex items-center justify-between gap-3">
                          <Text className="text-ui-fg-subtle text-small">Feedback</Text>
                          {feedbackSubmittedForRunId === runId ? (
                            <Text className="text-ui-fg-subtle text-small">Submitted</Text>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {([
                            { value: "one", label: "1" },
                            { value: "two", label: "2" },
                            { value: "three", label: "3" },
                            { value: "four", label: "4" },
                            { value: "five", label: "5" },
                          ] as const).map((opt) => (
                            <Button
                              key={opt.value}
                              type="button"
                              size="small"
                              variant={feedbackRating === opt.value ? "primary" : "secondary"}
                              onClick={() => setFeedbackRating(opt.value)}
                              disabled={!canSubmitFeedback || feedback.isPending}
                            >
                              {opt.label}
                            </Button>
                          ))}
                        </div>

                        <div className="mt-2">
                          <Textarea
                            rows={2}
                            value={feedbackComment}
                            onChange={(e) => setFeedbackComment(e.target.value)}
                            placeholder="Optional comment"
                            disabled={!canSubmitFeedback || feedback.isPending}
                          />
                        </div>

                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <Input
                            value={feedbackSubmittedBy}
                            onChange={(e) => {
                              setFeedbackSubmittedByTouched(true)
                              setFeedbackSubmittedBy(e.target.value)
                            }}
                            placeholder="Submitted by"
                            disabled={!canSubmitFeedback || feedback.isPending}
                          />

                          <Button
                            type="button"
                            size="small"
                            onClick={submitFeedback}
                            isLoading={feedback.isPending}
                            disabled={!canSubmitFeedback}
                          >
                            Submit
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {stream.state.error ? (
                    <div className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass("assistant")}`}>
                      <Text className="text-ui-fg-subtle text-small">Error</Text>
                      <div className="whitespace-pre-wrap break-words">{String(stream.state.error)}</div>
                    </div>
                  ) : null}

                  <div ref={bottomRef} />
                </div>
              </div>

              <div className="mt-auto border-t border-ui-border-base bg-ui-bg-base">
                <div className="px-3 py-3">
                  <div className="group w-full max-w-[900px] rounded-2xl border border-ui-border-base bg-ui-bg-base shadow-sm">
                    <div className="p-3">
                      <Textarea
                        rows={1}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask something… e.g. list all products, update partner name…"
                        disabled={chat.isPending || stream.state.isStreaming}
                        className="resize-none border-none bg-transparent p-0 outline-none focus:outline-none focus:ring-0 min-h-[44px]"
                      />

                      <div className="mt-2 flex items-center justify-end gap-2">
                        {stream.state.isStreaming ? (
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => {
                              stream.stop()
                              setRunStatus("idle")
                            }}
                            size="small"
                          >
                            Stop
                          </Button>
                        ) : null}
                        <Button type="button" isLoading={chat.isPending} disabled={!canSend} onClick={send} size="small">
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" type="button">
              Close
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default AiV2Chat
