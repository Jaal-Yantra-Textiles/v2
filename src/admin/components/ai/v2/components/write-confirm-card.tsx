import React from "react"
import { Button, Text } from "@medusajs/ui"

export type WriteConfirmPayload = {
  reason?: string
  requires_confirmation?: boolean
  request?: {
    method?: string
    path?: string
    query?: any
    body?: any
  }
}

const json = (v: any) => {
  try {
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return String(v)
  }
}

export const WriteConfirmCard: React.FC<{
  payload: WriteConfirmPayload
  isLoading?: boolean
  onConfirm: () => void
  onCancel: () => void
}> = ({ payload, isLoading, onConfirm, onCancel }) => {
  const method = String(payload?.request?.method || "").toUpperCase()
  const path = String(payload?.request?.path || "")

  return (
    <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/20 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-1">
          <svg className="w-5 h-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-8.03 14A2 2 0 004 20h16a2 2 0 001.74-3.14l-8.03-14a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <Text className="text-small font-medium">{payload?.reason || "Confirmation required"}</Text>
          <Text className="text-ui-fg-subtle text-small mt-1">{method} {path}</Text>
          <pre className="mt-3 text-xs whitespace-pre-wrap break-words bg-ui-bg-base p-2 rounded border border-ui-border-base">{json(payload?.request)}</pre>

          <div className="mt-3 flex items-center gap-2">
            <Button size="small" variant="secondary" type="button" onClick={onCancel} disabled={isLoading}>
              Cancel
            </Button>
            <Button size="small" type="button" onClick={onConfirm} isLoading={isLoading}>
              Confirm & Execute
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
