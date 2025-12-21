import React from "react"
import { Button, Heading, Input, Text } from "@medusajs/ui"
import { ThreadSelect } from "./thread-select"

export type StartChatPanelProps = {
  threadPickerResource: string
  onResourceChange: (value: string) => void
  onLoadThreads: () => void
  onStartNewChat: () => void
  availableThreads: any[]
  selectedThreadId: string
  onSelectThread: (value: string) => void
  onOpenThread: () => void
  loadThreadsLoading?: boolean
  createThreadLoading?: boolean
  openThreadLoading?: boolean
  threadsAvailable?: boolean
}

export const StartChatPanel: React.FC<StartChatPanelProps> = ({
  threadPickerResource,
  onResourceChange,
  onLoadThreads,
  onStartNewChat,
  availableThreads,
  selectedThreadId,
  onSelectThread,
  onOpenThread,
  loadThreadsLoading,
  createThreadLoading,
  openThreadLoading,
}) => {
  return (
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
                onChange={(e) => onResourceChange(e.target.value)}
                placeholder="ai:v2 or ai:v2:product"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" type="button" isLoading={loadThreadsLoading} onClick={onLoadThreads}>
                Load chats
              </Button>
              <Button type="button" isLoading={createThreadLoading} onClick={onStartNewChat}>
                New chat
              </Button>
            </div>

            {availableThreads.length ? (
              <div className="mt-2">
                <Text className="text-ui-fg-subtle text-small mb-1">Existing threads</Text>
                <ThreadSelect
                  availableThreads={availableThreads}
                  selectedThreadId={selectedThreadId}
                  onSelect={onSelectThread}
                  onOpenSelected={onOpenThread}
                  isLoading={openThreadLoading}
                  areActionsDisabled={!selectedThreadId}
                  buttonFullWidth
                />
              </div>
            ) : null}

            <Text className="text-ui-fg-subtle text-small">
              You can also just type a message below and hit Send — a new thread will be created automatically.
            </Text>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StartChatPanel
