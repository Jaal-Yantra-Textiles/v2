import React from "react"
import { Text } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import { MarkdownMessage } from "./markdown-message"
import { WriteConfirmCard } from "./write-confirm-card"
import { SuspendedWorkflowSelector } from "../../chat/suspended-workflow-selector"
import type { UiMessage } from "../types"
import type { AiV2StreamState } from "../../../../hooks/api/ai-v2"
import { bubbleClass } from "../utils/message"

export type MessageListProps = {
  messages: UiMessage[]
  streamState: AiV2StreamState
  chatIsPending: boolean
  suspended: { runId: string; payload: any } | null
  suspendedKind: "write" | "select" | null
  acceptWrite: () => void
  cancelWrite: () => void
  selectOption: (id: string, type?: "option" | "action") => void
  resumeIsPending: boolean
  bottomRef: React.RefObject<HTMLDivElement>
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamState,
  chatIsPending,
  suspended,
  suspendedKind,
  acceptWrite,
  cancelWrite,
  selectOption,
  resumeIsPending,
  bottomRef,
}) => {
  const isLoading = chatIsPending || streamState.isStreaming || streamState.active

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <div className="flex flex-col gap-y-3 pb-6">
        {messages.length === 0 && isLoading ? (
          <div className="flex w-full items-center justify-center gap-2 py-10 text-ui-fg-subtle">
            <Spinner className="animate-spin" />
            <span className="text-small">{streamState.active || "Thinking..."}</span>
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass(m.role)} animate-in fade-in slide-in-from-bottom-1 duration-200`}
          >
            <Text className="text-ui-fg-subtle text-small block mb-1">{m.role === "user" ? "You" : "Assistant"}</Text>
            <div className="whitespace-pre-wrap break-words">
              {m.role === "assistant" ? <MarkdownMessage value={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {streamState.isStreaming && streamState.liveText ? (
          <div className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass("assistant")} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
            <Text className="text-ui-fg-subtle text-small block mb-1">Assistant (draft)</Text>
            <div className="whitespace-pre-wrap break-words">
              <MarkdownMessage value={streamState.liveText} />
            </div>
          </div>
        ) : null}

        {suspended && suspendedKind === "write" ? (
          <div className="max-w-[92%]">
            <WriteConfirmCard
              payload={suspended.payload}
              isLoading={resumeIsPending}
              onConfirm={acceptWrite}
              onCancel={cancelWrite}
            />
          </div>
        ) : null}

        {suspended && suspendedKind === "select" ? (
          <div className="max-w-[92%]">
            <SuspendedWorkflowSelector
              reason={String(suspended.payload?.reason || "Please select an option")}
              options={Array.isArray(suspended.payload?.options) ? suspended.payload.options : []}
              actions={Array.isArray(suspended.payload?.actions) ? suspended.payload.actions : undefined}
              onSelect={selectOption}
              isLoading={resumeIsPending}
            />
          </div>
        ) : null}

        {isLoading && messages.length ? (
          <div className={`flex w-full ${bubbleClass("assistant")}`}>
            <div className="flex items-center gap-2 px-4 py-3 rounded-2xl rounded-tl-none bg-ui-bg-subtle text-ui-fg-subtle">
              <Spinner className="animate-spin" />
              <span className="text-small">{streamState.active || "Thinking..."}</span>
            </div>
          </div>
        ) : null}

        {streamState.error ? (
          <div className={`max-w-[85%] rounded-md px-3 py-2 ${bubbleClass("assistant")}`}>
            <Text className="text-ui-fg-subtle text-small">Error</Text>
            <div className="whitespace-pre-wrap break-words">{String(streamState.error)}</div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
