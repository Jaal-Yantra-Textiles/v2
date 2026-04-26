// @ts-nocheck
import React from "react"
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react"
import { Text } from "@medusajs/ui"
import { usePanelData, useDashboard, StatsPanel } from "../../../hooks/api/stats"
import { PanelRenderer } from "../../stats/panel-renderer"

type Attrs = {
  panelId: string | null
  title: string | null
  data?: any
  display?: Record<string, any> | null
  panelType?: StatsPanel["type"] | null
}

export const StatsPanelNodeView: React.FC<NodeViewProps> = ({ node, selected }) => {
  const attrs = node.attrs as Attrs
  const panelId = attrs.panelId

  const { data, isLoading, error } = usePanelData(panelId ?? undefined, {
    enabled: !!panelId,
  })

  // Fallback: server-injected snapshot (when rendered from stored JSON without admin API)
  const result = data ?? (attrs.data
    ? {
        panel_id: panelId ?? undefined,
        data: attrs.data,
        display: attrs.display ?? {},
        operation_type: "",
        cache_hit: true,
        resolved_at: new Date().toISOString(),
      }
    : undefined)

  const panelType = (attrs.panelType as StatsPanel["type"]) ?? "metric"

  return (
    <NodeViewWrapper
      className={`stats-panel-node my-3 border rounded-lg overflow-hidden bg-ui-bg-base ${
        selected ? "ring-2 ring-ui-border-interactive" : ""
      }`}
      data-drag-handle
    >
      <div className="flex items-center justify-between px-3 py-2 border-b bg-ui-bg-subtle">
        <div className="flex flex-col min-w-0">
          <Text size="xsmall" weight="plus" className="truncate">
            {attrs.title ?? "Stats panel"}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {panelId ?? "no panel selected"}
          </Text>
        </div>
      </div>
      <div className="min-h-[100px]">
        {!panelId ? (
          <div className="p-4">
            <Text size="small" className="text-ui-fg-muted">
              No panel selected.
            </Text>
          </div>
        ) : (
          <PanelRenderer
            panel={{ name: attrs.title ?? "", type: panelType, display: attrs.display ?? {} } as any}
            result={result}
            isLoading={isLoading}
            error={error ? (error as Error).message : undefined}
          />
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default StatsPanelNodeView
