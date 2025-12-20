import React from "react"
import { Text } from "@medusajs/ui"

export type AiV2ActivityItem = {
  id: string
  ts: number
  type: string
  data?: any
}

const Dots: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const [i, setI] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setI((v) => (v + 1) % 4), 450)
    return () => window.clearInterval(t)
  }, [active])

  return <span className="inline-block w-[16px]">{".".repeat(i)}</span>
}

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
    return JSON.stringify(v ?? {}, null, 2)
  } catch {
    return String(v)
  }
}

export const ActivityFeed: React.FC<{
  title?: string
  items: AiV2ActivityItem[]
  isStreaming?: boolean
  activeLabel?: string
}> = ({ title = "Live activity", items, isStreaming }) => {
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!bottomRef.current) return
    bottomRef.current.scrollIntoView({ behavior: "smooth" })
  }, [items.length, isStreaming])

  if (!items.length) {
    return (
      <div className="px-1">
        {isStreaming ? (
          <Text className="text-ui-fg-subtle text-small">
            Running<Dots />
          </Text>
        ) : null}
      </div>
    )
  }

  return (
    <div className="border border-ui-border-base rounded-lg bg-ui-bg-base overflow-hidden">
      <div className="px-3 py-2 border-b border-ui-border-base flex items-center justify-between">
        <Text className="text-ui-fg-subtle text-small">{title}</Text>
        {isStreaming ? (
          <Text className="text-ui-fg-subtle text-small">
            Running<Dots />
          </Text>
        ) : null}
      </div>
      <div className="max-h-[34vh] overflow-auto">
        <div className="p-3 space-y-2">
          {items.length === 0 ? (
            <Text className="text-ui-fg-subtle text-small">No activity yet.</Text>
          ) : (
            items.map((it) => (
              <details
                key={it.id}
                className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2 animate-in fade-in slide-in-from-bottom-1 duration-200"
                open={false}
              >
                <summary className="cursor-pointer select-none">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{it.type}</div>
                    <div className="text-ui-fg-subtle text-xs">{fmtTime(it.ts)}</div>
                  </div>
                </summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap break-words bg-ui-bg-base p-2 rounded">{json(it.data)}</pre>
              </details>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
