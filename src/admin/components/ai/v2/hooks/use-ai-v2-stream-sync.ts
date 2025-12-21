import React from "react"
import type { UiMessage, AiV2RunStatus } from "../types"
import { createLocalId } from "../utils/message"
import { AiV2Step, AiV2WorkflowOutput, useAiV2ChatStream } from "../../../../hooks/api/ai-v2"
export type SuspendedState = { runId: string; payload: any } | null

export type UseAiV2StreamSyncOptions = {
  stream: ReturnType<typeof useAiV2ChatStream>
  chatIsPending: boolean
  suspended: SuspendedState
  setSuspended: React.Dispatch<React.SetStateAction<SuspendedState>>
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>
  setLastSteps: React.Dispatch<React.SetStateAction<AiV2Step[] | undefined>>
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>
  setActiveResourceId: React.Dispatch<React.SetStateAction<string | null>>
  setThreadPickerResource: React.Dispatch<React.SetStateAction<string>>
  setRunId: React.Dispatch<React.SetStateAction<string | null>>
  setRunStatus: React.Dispatch<React.SetStateAction<AiV2RunStatus>>
  bottomRef: React.RefObject<HTMLDivElement>
  messageCount: number
}

export const useAiV2StreamSync = ({
  stream,
  chatIsPending,
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
  messageCount,
}: UseAiV2StreamSyncOptions) => {
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
  }, [stream.state.final, setMessages, setLastSteps, setActiveThreadId, setActiveResourceId, setThreadPickerResource])

  React.useEffect(() => {
    if (stream.state.runId) setRunId(stream.state.runId)
  }, [stream.state.runId, setRunId])

  React.useEffect(() => {
    if (stream.state.isStreaming || stream.state.active) {
      setRunStatus("running")
    }
  }, [stream.state.isStreaming, stream.state.active, setRunStatus])

  React.useEffect(() => {
    if (stream.state.final) setRunStatus("completed")
  }, [stream.state.final, setRunStatus])

  React.useEffect(() => {
    if (stream.state.error) setRunStatus("error")
  }, [stream.state.error, setRunStatus])

  React.useEffect(() => {
    if (stream.state.isStreaming) return
    if (stream.state.active) return
    if (stream.state.error) return
    if (stream.state.final) return
    if (suspended) return
    if (chatIsPending) return
    setRunStatus((prev) => (prev === "running" ? "idle" : prev))
  }, [
    stream.state.isStreaming,
    stream.state.active,
    stream.state.error,
    stream.state.final,
    suspended,
    chatIsPending,
    setRunStatus,
  ])

  React.useEffect(() => {
    if (!bottomRef.current) return
    bottomRef.current.scrollIntoView({ behavior: "smooth" })
  }, [bottomRef, messageCount, suspended?.runId, stream.state.isStreaming, stream.state.active, stream.state.liveText])

  React.useEffect(() => {
    if (Array.isArray(stream.state.steps) && stream.state.steps.length) {
      setLastSteps(stream.state.steps)
    }
  }, [stream.state.steps, setLastSteps])

  React.useEffect(() => {
    if (stream.state.suspended) {
      setSuspended({ runId: stream.state.suspended.runId, payload: stream.state.suspended.suspendPayload })
      if (stream.state.suspended.runId) setRunId(stream.state.suspended.runId)
      setRunStatus("suspended")
    }
  }, [stream.state.suspended, setSuspended, setRunId, setRunStatus])
}
