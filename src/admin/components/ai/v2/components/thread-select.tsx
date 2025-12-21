import React from "react"
import { Button, Select } from "@medusajs/ui"

export type ThreadSelectProps = {
  availableThreads: any[]
  selectedThreadId: string
  onSelect: (value: string) => void
  onOpenSelected: () => void
  areActionsDisabled?: boolean
  isLoading?: boolean
  className?: string
  buttonFullWidth?: boolean
}

export const ThreadSelect: React.FC<ThreadSelectProps> = ({
  availableThreads,
  selectedThreadId,
  onSelect,
  onOpenSelected,
  areActionsDisabled,
  isLoading,
  className,
  buttonFullWidth = false,
}) => {
  if (!availableThreads.length) {
    return null
  }

  return (
    <div className={className}>
      <Select value={selectedThreadId} onValueChange={onSelect}>
        <Select.Trigger>
          <Select.Value placeholder="Select a thread…" />
        </Select.Trigger>
        <Select.Content>
          {availableThreads.map((t: any) => (
            <Select.Item key={String(t.id)} value={String(t.id)}>
              {t.title ? `${t.title} · ` : ""}
              {String(t.id)}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
      <Button
        className={buttonFullWidth ? "mt-2 w-full" : "mt-2"}
        variant="secondary"
        type="button"
        size="small"
        isLoading={isLoading}
        disabled={areActionsDisabled || !selectedThreadId}
        onClick={onOpenSelected}
      >
        Open selected
      </Button>
    </div>
  )
}

export default ThreadSelect
