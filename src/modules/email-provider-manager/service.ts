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
    const allocations: ProviderAllocation[] = []
    let emailIndex = 0

    // Sort by remaining capacity descending — fill the provider with more room first
    capacities.sort((a, b) => b.remaining - a.remaining)

    for (const cap of capacities) {
      if (emailIndex >= emails.length) break
      if (cap.remaining <= 0) continue

      const count = Math.min(cap.remaining, emails.length - emailIndex)
      const assignedEmails = emails.slice(emailIndex, emailIndex + count)

      allocations.push({
        provider: cap.provider,
        emails: assignedEmails,
      })

      emailIndex += count
    }

    // Anything beyond capacity is overflow — to be queued for the next day
    const overflow = emailIndex < emails.length
      ? emails.slice(emailIndex)
      : []

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
      status: "pending",
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
