import { MedusaContainer } from "@medusajs/framework/types"
import { STATS_MODULE } from "."
import StatsService from "./service"
import { resolvePanel } from "./resolver"

type TipTapNode = {
  type?: string
  attrs?: Record<string, any>
  content?: TipTapNode[]
  [key: string]: any
}

function collectPanelIds(node: TipTapNode | null | undefined, acc: Set<string>): void {
  if (!node || typeof node !== "object") return
  if (node.type === "statsPanel" && typeof node.attrs?.panelId === "string") {
    acc.add(node.attrs.panelId)
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectPanelIds(child, acc)
  }
}

function applyPanelData(
  node: TipTapNode | null | undefined,
  panelDataMap: Map<string, any>
): void {
  if (!node || typeof node !== "object") return
  if (node.type === "statsPanel" && node.attrs?.panelId) {
    const snapshot = panelDataMap.get(node.attrs.panelId)
    if (snapshot) {
      node.attrs = {
        ...node.attrs,
        data: snapshot.data,
        display: snapshot.display ?? node.attrs.display ?? {},
        panelType: snapshot.panelType ?? node.attrs.panelType,
        _resolvedAt: snapshot.resolved_at,
      }
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) applyPanelData(child, panelDataMap)
  }
}

/**
 * Walks a TipTap document, finds statsPanel nodes, resolves their data
 * server-side, and mutates the document to inject { data, display, panelType }
 * into each node's attrs. Safe to call on any blog block content.
 *
 * Returns the same doc reference (mutated) for convenience.
 */
export async function injectStatsPanelData<T extends TipTapNode | TipTapNode[] | any>(
  container: MedusaContainer,
  doc: T
): Promise<T> {
  if (!doc) return doc

  const rootNodes: TipTapNode[] = Array.isArray(doc) ? doc : [doc]
  const ids = new Set<string>()
  for (const n of rootNodes) collectPanelIds(n, ids)
  if (ids.size === 0) return doc

  const service: StatsService = container.resolve(STATS_MODULE)
  const panelDataMap = new Map<string, any>()

  await Promise.all(
    Array.from(ids).map(async (panelId) => {
      try {
        const panel = await service.retrieveStatsPanel(panelId)
        const result = await resolvePanel(container, {
          id: panel.id,
          dashboard_id: (panel as any).dashboard_id,
          operation_type: panel.operation_type,
          operation_options: (panel.operation_options ?? {}) as Record<string, any>,
          display: (panel.display ?? {}) as Record<string, any>,
          cache_ttl_seconds: panel.cache_ttl_seconds,
        })
        panelDataMap.set(panelId, {
          data: result.data,
          display: panel.display ?? {},
          panelType: panel.type,
          error: result.error,
          resolved_at: result.resolved_at,
        })
      } catch (err: any) {
        panelDataMap.set(panelId, {
          data: null,
          display: {},
          panelType: null,
          error: err?.message ?? "Panel resolution failed",
          resolved_at: new Date().toISOString(),
        })
      }
    })
  )

  for (const n of rootNodes) applyPanelData(n, panelDataMap)
  return doc
}
