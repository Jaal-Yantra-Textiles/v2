import React from "react"
import { Text } from "@medusajs/ui"
import type { AiV2Step } from "../../../../hooks/api/ai-v2"

const fmtTime = (ts?: number) => {
  if (!ts) return ""
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return String(ts)
  }
}

const json = (v: any) => {
  try {
    if (typeof v === "string") {
      const trimmed = v.trim()
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.stringify(JSON.parse(trimmed), null, 2)
        } catch {
          // ignore
        }
      }
      return v
    }

    if (v && typeof v === "object" && typeof (v as any).preview === "string") {
      const preview = String((v as any).preview)
      const trimmed = preview.trim()
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed)
          return JSON.stringify({ ...(v as any), preview: parsed }, null, 2)
        } catch {
          // ignore
        }
      }
    }

    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return String(v)
  }
}

export const StepTimeline: React.FC<{ steps?: AiV2Step[]; hideEmpty?: boolean }> = ({ steps, hideEmpty = false }) => {
  const items = Array.isArray(steps) ? steps : []
  if (!items.length) {
    if (hideEmpty) return null
    return (
      <div className="border border-ui-border-base rounded-lg p-3 bg-ui-bg-base">
        <Text className="text-ui-fg-subtle text-small">No steps yet.</Text>
      </div>
    )
  }

  return (
    <div className="border border-ui-border-base rounded-lg bg-ui-bg-base overflow-hidden">
      <div className="px-3 py-2 border-b border-ui-border-base">
        <Text className="text-ui-fg-subtle text-small">Run steps</Text>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <div className="p-3 space-y-2">
          {items.map((s) => (
            <details key={s.id} className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
              <summary className="cursor-pointer select-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">
                    {s.type}
                    {typeof s.confidence === "number" ? (
                      <span className="ml-2 text-ui-fg-subtle text-xs">conf {s.confidence.toFixed(2)}</span>
                    ) : null}
                  </div>
                  <div className="text-ui-fg-subtle text-xs">{fmtTime(s.ts)}</div>
                </div>
                {s.rationale_short ? (
                  <div className="mt-1 text-ui-fg-subtle text-xs">{s.rationale_short}</div>
                ) : null}
              </summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap break-words bg-ui-bg-base p-2 rounded">{json(s.data)}</pre>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
