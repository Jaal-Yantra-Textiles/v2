/**
 * Shared MCP core — observability seam (#844).
 *
 * The dispatcher emits one `McpToolEvent` per call through `ctx.observe`. This
 * module gives surfaces a ready-made sink that logs a structured line via the
 * Medusa logger — usage, latency, outcome, per-surface. It is intentionally
 * thin: the fuller work of #844 (persisting to the `ai_usage` ledger for
 * cross-surface reporting) plugs in here by swapping/extending `makeMcpLogSink`
 * without touching the dispatcher or any registry.
 */
import type { McpToolEvent } from "./types"

type MinimalLogger = {
  info?: (msg: string) => void
  warn?: (msg: string) => void
  error?: (msg: string) => void
}

/**
 * Build an observe() sink that logs each tool call as a single structured line.
 * `warn` for soft errors, `info` otherwise. Safe to pass a partial logger.
 */
export const makeMcpLogSink =
  (logger: MinimalLogger | undefined) =>
  (evt: McpToolEvent): void => {
    if (!logger) return
    const line =
      `[mcp:${evt.surface}] ${evt.tool} ${evt.method} ${evt.path ?? ""}` +
      ` outcome=${evt.outcome} executed=${evt.executed} ok=${evt.ok}` +
      (evt.ms !== undefined ? ` ms=${evt.ms}` : "") +
      (evt.error ? ` error=${JSON.stringify(evt.error)}` : "") +
      (evt.context ? ` context=${JSON.stringify(evt.context.slice(0, 200))}` : "")
    if (!evt.ok && evt.executed) logger.warn?.(line)
    else logger.info?.(line)
  }
