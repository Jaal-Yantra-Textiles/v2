import { MedusaService } from "@medusajs/framework/utils"
import AiUsageEvent from "./models/ai-usage-event"
import type { McpToolEvent } from "../../lib/mcp-core"

export const MONTHLY_QUOTA = {
  image_describe: 10,
  // Roadmap #6/#337 — partner image segmentation (fal.ai BiRefNet background
  // removal). Same free-tier soft-paywall policy as image_describe; no
  // migration needed (operation is a generic string column).
  image_segment: 10,
  // Roadmap #6/#337 — partner depth/normal-map estimation (fal.ai MiDaS).
  // Same free-tier soft-paywall policy as image_segment; no migration needed
  // (operation is a generic string column).
  image_depth: 10,
} as const

export type AiOperation = keyof typeof MONTHLY_QUOTA

class AiUsageService extends MedusaService({ AiUsageEvent }) {
  constructor() {
    super(...arguments as any)
  }

  /**
   * Start of the current UTC month. Simple and predictable — no timezone
   * magic. We cap per calendar month; if partners ask for sliding windows
   * later we flip this to `now - 30d`.
   */
  private startOfMonth(): Date {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  }

  async countThisMonth(
    partner_id: string,
    operation: AiOperation
  ): Promise<number> {
    const [, count] = await this.listAndCountAiUsageEvents(
      {
        partner_id,
        operation,
        created_at: { $gte: this.startOfMonth() },
      } as any,
      { take: 0 }
    )
    return count
  }

  /**
   * Atomic-ish quota check: returns `{ used, limit, allowed }` for the
   * current month. Caller decides whether to throw or just record.
   */
  async checkQuota(
    partner_id: string,
    operation: AiOperation
  ): Promise<{ used: number; limit: number; allowed: boolean }> {
    const limit = MONTHLY_QUOTA[operation]
    const used = await this.countThisMonth(partner_id, operation)
    return { used, limit, allowed: used < limit }
  }

  async recordUsage(
    partner_id: string,
    operation: AiOperation,
    metadata?: Record<string, any>
  ) {
    await this.createAiUsageEvents({
      partner_id,
      operation,
      metadata: metadata ?? null,
    })
  }

  /**
   * MCP observability ledger (#844). Persists one row per MCP tool dispatch
   * across the store/partner/admin surfaces. Best-effort: callers fire this
   * from the dispatcher's observe sink and must not let a ledger failure break
   * the tool call. `operation` is namespaced `mcp:<tool>` so it never collides
   * with the image-quota operations and ledger reads can filter it out.
   */
  async recordMcpEvent(
    evt: McpToolEvent,
    actor?: { id?: string | null; type?: string | null; partner_id?: string | null }
  ) {
    await this.createAiUsageEvents({
      partner_id: actor?.partner_id ?? null,
      operation: `mcp:${evt.tool}`,
      surface: evt.surface,
      actor_id: actor?.id ?? null,
      actor_type: actor?.type ?? null,
      metadata: {
        method: evt.method,
        path: evt.path ?? null,
        outcome: evt.outcome,
        executed: evt.executed,
        ok: evt.ok,
        ms: evt.ms ?? null,
        error: evt.error ?? null,
        context: evt.context ?? null,
      },
    })
  }

  /**
   * Read recent MCP ledger rows (optionally scoped to one surface), newest
   * first. Backs the /admin/mcp/usage endpoint / get_mcp_usage tool.
   */
  async listMcpUsage(
    opts: { surface?: string; limit?: number } = {}
  ): Promise<{ events: any[]; count: number }> {
    const filters: Record<string, any> = { operation: { $like: "mcp:%" } }
    if (opts.surface) {
      filters.surface = opts.surface
    }
    const [events, count] = await this.listAndCountAiUsageEvents(filters, {
      take: opts.limit ?? 50,
      order: { created_at: "DESC" },
    } as any)
    return { events, count }
  }
}

export default AiUsageService
