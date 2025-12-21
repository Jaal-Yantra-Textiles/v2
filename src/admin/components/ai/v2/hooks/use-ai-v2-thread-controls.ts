import React from "react"
import { useChatThread, useChatThreads, useCreateChatThread } from "../../../../hooks/api/ai"
import type { UiMessage, AiV2RunStatus } from "../types"
import { createLocalId, uiMessageToText } from "../utils/message"

export type ThreadControlsOptions = {
  defaultResourceId: string
  entity?: string
  onMessagesReset: (messages: UiMessage[]) => void
  onInputReset: () => void
  setLastSteps: React.Dispatch<React.SetStateAction<any[] | undefined>>
  setRunId: React.Dispatch<React.SetStateAction<string | null>>
  setRunStatus: React.Dispatch<React.SetStateAction<AiV2RunStatus>>
  setSuspended: React.Dispatch<React.SetStateAction<{ runId: string; payload: any } | null>>
  setFeedbackSubmittedForRunId: React.Dispatch<React.SetStateAction<string | null>>
  stopStreaming: () => void
}

export const useAiV2ThreadControls = ({
  defaultResourceId,
  entity,
  onMessagesReset,
  onInputReset,
  setLastSteps,
  setRunId,
  setRunStatus,
  setSuspended,
  setFeedbackSubmittedForRunId,
  stopStreaming,
}: ThreadControlsOptions) => {
  const [threadPickerResource, setThreadPickerResource] = React.useState(defaultResourceId)
  const [availableThreads, setAvailableThreads] = React.useState<any[]>([])
  const [selectedThreadId, setSelectedThreadId] = React.useState<string>("")
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null)
  const [activeResourceId, setActiveResourceId] = React.useState<string | null>(null)

  const threadApi = useChatThread()
  const threadsApi = useChatThreads()
  const createThreadApi = useCreateChatThread()

  const applyThreadReset = React.useCallback(() => {
    setLastSteps(undefined)
    setRunId(null)
    setRunStatus("idle")
    setSuspended(null)
    setFeedbackSubmittedForRunId(null)
  }, [setLastSteps, setRunId, setRunStatus, setSuspended, setFeedbackSubmittedForRunId])

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
      onMessagesReset(mapped)
      onInputReset()
      applyThreadReset()
    },
    [threadApi, threadPickerResource, onMessagesReset, onInputReset, applyThreadReset]
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
    onMessagesReset([])
    onInputReset()
    applyThreadReset()
  }, [createThreadApi, threadPickerResource, entity, onMessagesReset, onInputReset, applyThreadReset])

  const resetThreadContext = React.useCallback(() => {
    stopStreaming()
    setRunStatus("idle")
    setActiveThreadId(null)
    setActiveResourceId(null)
    setAvailableThreads([])
    setSelectedThreadId("")
    onMessagesReset([])
    setLastSteps(undefined)
    setRunId(null)
    setSuspended(null)
    setFeedbackSubmittedForRunId(null)
  }, [stopStreaming, setRunStatus, onMessagesReset, setLastSteps, setRunId, setSuspended, setFeedbackSubmittedForRunId])

  return {
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
  }
}
