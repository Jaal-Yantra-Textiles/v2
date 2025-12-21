import React from "react"
import { IconButton } from "@medusajs/ui"
import { ArrowRightMini, PauseSolid } from "@medusajs/icons"

export type ChatComposerProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  canSend: boolean
  isStreaming: boolean
  onStop: () => void
  onSend: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  disabled = false,
  canSend,
  isStreaming,
  onStop,
  onSend,
  onKeyDown,
}) => {
  return (
    <div className="flex items-center gap-3 rounded-full border border-ui-border-base bg-ui-bg-base px-4 py-2 shadow-sm">
      <textarea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask something… e.g. list all products, update partner name…"
        disabled={disabled}
        onKeyDown={onKeyDown}
        className="max-h-32 flex-1 resize-none border-none bg-transparent p-0 text-base outline-none focus:outline-none"
      />
      <div className="flex items-center gap-2">
        {isStreaming ? (
          <IconButton
            size="small"
            variant="transparent"
            className="rounded-full"
            onClick={onStop}
            aria-label="Stop streaming"
          >
            <PauseSolid />
          </IconButton>
        ) : null}
        <IconButton
          size="small"
          variant="primary"
          className="rounded-full"
          disabled={!canSend || disabled}
          onClick={onSend}
          aria-label="Send message"
        >
          <ArrowRightMini />
        </IconButton>
      </div>
    </div>
  )
}

export default ChatComposer
