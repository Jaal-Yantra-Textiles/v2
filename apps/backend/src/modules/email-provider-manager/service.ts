import { MedusaService } from "@medusajs/framework/utils"
import EmailUsage from "./models/email-usage"
import EmailQueue from "./models/email-queue"

type ProviderConfig = {
  id: string
  daily_limit: number
}

export type ProviderAllocation = {
  provider: string
  emails: string[]
}

export type DistributionResult = {
  allocations: ProviderAllocation[]
  overflow: string[]
}

class EmailProviderManagerService extends MedusaService({ EmailUsage, EmailQueue }) {
  private providers: ProviderConfig[] = [
    { id: "mailjet", daily_limit: parseInt(process.env.MAILJET_DAILY_LIMIT || "200", 10) },
    { id: "resend", daily_limit: parseInt(process.env.RESEND_DAILY_LIMIT || "100", 10) },
  ]

  // Fairness floor: when there's enough volume, bring every configured provider
  // up to this many sends/day (capped by its own daily_limit) BEFORE piling the
  // rest onto whichever has the most room. Without it, the greedy "fill largest
  // remaining first" strategy dumps small/medium batches entirely on Mailjet and
  // never touches Resend — wasting Resend's ~100/day free allowance. 70 keeps a
  // safe margin under Resend's 100 cap. Override with EMAIL_MIN_PER_PROVIDER_PER_DAY.
  private minPerProviderPerDay: number = parseInt(
    process.env.EMAIL_MIN_PER_PROVIDER_PER_DAY || "70",
    10
  )

  /**
   * Get today's date string in YYYY-MM-DD format
   */
  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0]
  }

  /**
   * Get the next day's date string in YYYY-MM-DD format
   */
  getNextDate(fromDate?: string): string {
    const d = fromDate ? new Date(fromDate + "T00:00:00Z") : new Date()
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().split("T")[0]
  }

  /**
   * Get current usage for a provider on a given date
   */
  async getProviderUsage(provider: string, date?: string): Promise<number> {
    const targetDate = date || this.getTodayDate()

    const records = await this.listEmailUsages(
      { provider, date: targetDate },
      { take: 1 }
    )

    if (!records || records.length === 0) {
      return 0
    }

    return records[0].count
  }

  /**
   * Get remaining capacity for all providers today
   */
  async getRemainingCapacity(): Promise<{ provider: string; remaining: number; limit: number; used: number }[]> {
    const today = this.getTodayDate()
    const result: { provider: string; remaining: number; limit: number; used: number }[] = []

    for (const config of this.providers) {
      const used = await this.getProviderUsage(config.id, today)
      result.push({
        provider: config.id,
        remaining: Math.max(0, config.daily_limit - used),
        limit: config.daily_limit,
        used,
      })
    }

    return result
  }

  /**
   * Get total remaining capacity across all providers
   */
  async getTotalRemainingCapacity(): Promise<number> {
    const capacities = await this.getRemainingCapacity()
    return capacities.reduce((sum, c) => sum + c.remaining, 0)
  }

  /**
   * Distribute a list of email addresses across providers based on remaining capacity.
   * Returns allocations (within capacity) and overflow (beyond daily limit).
   */
  async distributeEmails(emails: string[]): Promise<DistributionResult> {
    const capacities = await this.getRemainingCapacity()

    // Consume emails from a single running pointer across both phases so the
    // overflow always stays the contiguous tail of the input.
    let emailIndex = 0
    const alloc = new Map<string, string[]>()
    const remaining = new Map(capacities.map((c) => [c.provider, c.remaining]))
    const take = (provider: string, n: number) => {
      if (n <= 0) return
      const slice = emails.slice(emailIndex, emailIndex + n)
      alloc.set(provider, [...(alloc.get(provider) || []), ...slice])
      remaining.set(provider, (remaining.get(provider) || 0) - n)
      emailIndex += n
    }

    // Phase 1 — fairness floor: top every provider up to minPerProviderPerDay
    // (capped by its daily_limit and today's usage), least-used first, so each
    // configured service actually sends and its daily allowance isn't wasted.
    const byUsedAsc = [...capacities].sort((a, b) => a.used - b.used)
    for (const cap of byUsedAsc) {
      if (emailIndex >= emails.length) break
      const floor = Math.min(this.minPerProviderPerDay, cap.limit)
      const deficit = Math.max(0, floor - cap.used)
      take(
        cap.provider,
        Math.min(deficit, remaining.get(cap.provider) || 0, emails.length - emailIndex)
      )
    }

    // Phase 2 — capacity fill: distribute the rest to the provider with the most
    // room left first.
    const byRemainingDesc = [...capacities].sort(
      (a, b) => (remaining.get(b.provider) || 0) - (remaining.get(a.provider) || 0)
    )
    for (const cap of byRemainingDesc) {
      if (emailIndex >= emails.length) break
      const rem = remaining.get(cap.provider) || 0
      if (rem <= 0) continue
      take(cap.provider, Math.min(rem, emails.length - emailIndex))
    }

    const allocations: ProviderAllocation[] = capacities
      .map((c) => ({ provider: c.provider, emails: alloc.get(c.provider) || [] }))
      .filter((a) => a.emails.length > 0)

    // Anything beyond capacity is overflow — to be queued for the next day
    const overflow = emailIndex < emails.length ? emails.slice(emailIndex) : []

    return { allocations, overflow }
  }

  /**
   * Queue overflow emails for sending on the next available day.
   * Each entry stores the full email payload as serialized JSON.
   */
  async queueOverflowEmails(
    entries: {
      to_email: string
      channel: string
      template: string
      data: Record<string, any>
    }[]
  ): Promise<number> {
    if (entries.length === 0) return 0

    const scheduledFor = this.getNextDate()
    const queueItems = entries.map((e) => ({
      to_email: e.to_email,
      channel: e.channel,
      template: e.template,
      data: JSON.stringify(e.data),
      status: "pending" as const,
      scheduled_for: scheduledFor,
      attempts: 0,
    }))

    await this.createEmailQueues(queueItems)
    return queueItems.length
  }

  /**
   * Record that emails were sent through a provider.
   * Creates or updates the daily usage record.
   */
  async recordUsage(provider: string, count: number): Promise<void> {
    const today = this.getTodayDate()

    const existing = await this.listEmailUsages(
      { provider, date: today },
      { take: 1 }
    )

    if (existing && existing.length > 0) {
      await this.updateEmailUsages({
        id: existing[0].id,
        count: existing[0].count + count,
      })
    } else {
      await this.createEmailUsages({
        provider,
        date: today,
        count,
      })
    }
  }

  /**
   * Get the provider configs (for display/logging purposes)
   */
  getProviderConfigs(): ProviderConfig[] {
    return [...this.providers]
  }

  /**
   * Update provider limits at runtime (e.g., if plan changes)
   */
  setProviderLimit(providerId: string, newLimit: number): void {
    const provider = this.providers.find((p) => p.id === providerId)
    if (provider) {
      provider.daily_limit = newLimit
    }
  }
}

export default EmailProviderManagerService
