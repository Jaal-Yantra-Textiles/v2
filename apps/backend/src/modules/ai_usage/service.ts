import { MedusaService } from "@medusajs/framework/utils"
import AiUsageEvent from "./models/ai-usage-event"

export const MONTHLY_QUOTA = {
  image_describe: 10,
  // Roadmap #6/#337 — partner image segmentation (fal.ai BiRefNet background
  // removal). Same free-tier soft-paywall policy as image_describe; no
  // migration needed (operation is a generic string column).
  image_segment: 10,
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
}

export default AiUsageService
