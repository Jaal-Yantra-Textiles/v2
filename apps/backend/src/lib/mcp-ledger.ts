/**
 * MCP → ai_usage ledger bridge (#844).
 *
 * `makeMcpLedgerSink(container, actor)` returns an `observe` sink for the shared
 * mcp-core dispatcher that BOTH logs a structured line (via the core log sink)
 * AND persists one `ai_usage_event` row per tool dispatch. It lives here — not
 * in mcp-core — so the core stays module-agnostic while every surface (store,
 * partner, admin) gets cross-surface observability by passing this as
 * `ctx.observe`.
 *
 * Persistence is best-effort and fire-and-forget: a ledger write must never
 * break or slow the actual tool call, so failures are logged and swallowed.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { makeMcpLogSink, type McpToolEvent } from "./mcp-core"
import { AI_USAGE_MODULE } from "../modules/ai_usage"
import type AiUsageService from "../modules/ai_usage/service"

export type McpActor = {
  id?: string | null
  type?: string | null
  partner_id?: string | null
}

/** Ops kill-switch: set MCP_LEDGER_DISABLED=true to log-only (no DB writes). */
function isLedgerDisabled(): boolean {
  const v = (process.env.MCP_LEDGER_DISABLED || "").trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

export function makeMcpLedgerSink(
  container: any,
  actor?: McpActor
): (evt: McpToolEvent) => void {
  let logger: any
  let aiUsage: AiUsageService | undefined
  try {
    logger = container?.resolve?.(ContainerRegistrationKeys.LOGGER)
  } catch {
    // logger optional
  }
  try {
    aiUsage = container?.resolve?.(AI_USAGE_MODULE)
  } catch {
    // module optional — degrade to log-only
  }

  const log = makeMcpLogSink(logger)
  const persist = !!aiUsage && !isLedgerDisabled()

  return (evt: McpToolEvent): void => {
    log(evt)
    if (!persist) return
    Promise.resolve(aiUsage!.recordMcpEvent(evt, actor)).catch((e) => {
      logger?.warn?.(
        `[mcp:${evt.surface}] ledger write failed: ${(e as Error).message}`
      )
    })
  }
}
