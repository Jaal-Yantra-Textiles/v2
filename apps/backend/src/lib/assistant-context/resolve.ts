/**
 * Resolving the context-cache service from a request scope, without letting a
 * cache problem take the conversation down with it.
 *
 * The cache is an optimisation: it saves a re-fetch. Nothing about a chat turn
 * depends on it. But a bare `scope.resolve()` of a module that is not
 * registered THROWS, and this call sits before `streamText` on the hot path of
 * both assistants — so an unregistered (or renamed, or misconfigured) module
 * turns "the cache is unavailable" into "every assistant turn 500s". That is
 * exactly what shipped in review, because the module was in neither
 * medusa-config.ts nor medusa-config.prod.ts.
 *
 * Registering it is the fix; this is the seatbelt, so the same class of
 * mistake degrades to a slower answer instead of no answer.
 */
import { ASSISTANT_CONTEXT_CACHE_MODULE } from "../../modules/assistant-context-cache"

export function resolveContextCache(
  scope: { resolve: (key: string) => unknown },
  logger?: { warn?: (m: string) => void }
): any | null {
  try {
    return scope.resolve(ASSISTANT_CONTEXT_CACHE_MODULE) ?? null
  } catch (e: any) {
    logger?.warn?.(
      `[assistant-context] context cache unavailable, continuing without it: ${e?.message}`
    )
    return null
  }
}
