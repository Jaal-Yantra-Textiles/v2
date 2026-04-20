import { MedusaContainer } from "@medusajs/framework/types"
import { operationRegistry } from "../visual_flows/operations/types"
import type { OperationContext, OperationResult } from "../visual_flows/operations/types"
import { statsCache, hashOptions } from "./cache"

export type PanelLike = {
  id: string
  dashboard_id?: string
  operation_type: string
  operation_options: Record<string, any>
  display?: Record<string, any>
  cache_ttl_seconds?: number | null
}

export type PanelResolveResult = {
  data: any
  error?: string
  operation_type: string
  cache_hit: boolean
  resolved_at: string
}

function buildPanelContext(
  container: MedusaContainer,
  panel: PanelLike
): OperationContext {
  return {
    container,
    dataChain: {
      $trigger: {
        payload: {},
        timestamp: new Date().toISOString(),
      },
      $accountability: { triggered_by: "stats_panel" },
      $env: {},
      $last: null,
    },
    flowId: `panel:${panel.dashboard_id ?? "preview"}`,
    executionId: `panel-render-${panel.id}-${Date.now()}`,
    operationId: panel.id,
    operationKey: panel.id,
  }
}

export async function resolvePanel(
  container: MedusaContainer,
  panel: PanelLike,
  opts: { skipCache?: boolean } = {}
): Promise<PanelResolveResult> {
  const cacheKey = `${panel.id}:${hashOptions(panel.operation_options)}`

  if (!opts.skipCache && panel.cache_ttl_seconds && panel.cache_ttl_seconds > 0) {
    const cached = statsCache.get(cacheKey)
    if (cached !== undefined) {
      return {
        ...cached,
        cache_hit: true,
        resolved_at: new Date().toISOString(),
      }
    }
  }

  const operation = operationRegistry.get(panel.operation_type)
  if (!operation) {
    return {
      data: null,
      error: `Unknown operation_type: ${panel.operation_type}`,
      operation_type: panel.operation_type,
      cache_hit: false,
      resolved_at: new Date().toISOString(),
    }
  }

  const context = buildPanelContext(container, panel)
  let result: OperationResult
  try {
    result = await operation.execute(panel.operation_options, context)
  } catch (error: any) {
    return {
      data: null,
      error: error.message,
      operation_type: panel.operation_type,
      cache_hit: false,
      resolved_at: new Date().toISOString(),
    }
  }

  const resolved: PanelResolveResult = {
    data: result.success ? result.data : null,
    error: result.success ? undefined : result.error,
    operation_type: panel.operation_type,
    cache_hit: false,
    resolved_at: new Date().toISOString(),
  }

  if (
    result.success &&
    !opts.skipCache &&
    panel.cache_ttl_seconds &&
    panel.cache_ttl_seconds > 0
  ) {
    statsCache.set(cacheKey, { ...resolved, cache_hit: false }, panel.cache_ttl_seconds)
  }

  return resolved
}

export function invalidatePanelCache(panelId: string): void {
  statsCache.invalidate(`${panelId}:`)
}
