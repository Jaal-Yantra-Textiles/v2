import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { CompiledPlan } from "./compiler"

/**
 * #459 P1 — Redis-backed cache for compiled flow plans.
 *
 * The column on `visual_flow` is the source of truth; this is a read-through
 * accelerator so the executor doesn't re-load + re-derive the plan from
 * Postgres on every execution. Keyed by `flowId:hash` so a save (which changes
 * the hash) implicitly invalidates stale entries.
 *
 * Everything here is BEST-EFFORT: prod wires the caching module, but dev/test
 * may not, so we resolve with `allowUnregistered` and swallow all errors — a
 * missing/broken cache must never break a save or an execution.
 */

const TTL_SECONDS = 60 * 60 * 24 // 24h; correctness comes from the hash, not TTL

export const planCacheKey = (flowId: string, hash: string): string =>
  `vflow:plan:${flowId}:${hash}`

function resolveCache(container: MedusaContainer): any | null {
  try {
    return container.resolve(Modules.CACHE, { allowUnregistered: true } as any) ?? null
  } catch {
    return null
  }
}

export async function cacheCompiledPlan(
  container: MedusaContainer,
  flowId: string,
  plan: CompiledPlan
): Promise<void> {
  const cache = resolveCache(container)
  if (!cache) return
  try {
    await cache.set(planCacheKey(flowId, plan.hash), plan, TTL_SECONDS)
  } catch {
    // best-effort
  }
}

export async function getCachedCompiledPlan(
  container: MedusaContainer,
  flowId: string,
  hash: string
): Promise<CompiledPlan | null> {
  const cache = resolveCache(container)
  if (!cache) return null
  try {
    return (await cache.get(planCacheKey(flowId, hash))) ?? null
  } catch {
    return null
  }
}
