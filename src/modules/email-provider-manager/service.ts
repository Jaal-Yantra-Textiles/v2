import { MedusaService } from "@medusajs/framework/utils"
import EmailUsage from "./models/email-usage"

type ProviderConfig = {
  id: string
  daily_limit: number
}

type ProviderAllocation = {
  provider: string
  emails: string[] // email addresses assigned to this provider
}

class EmailProviderManagerService extends MedusaService({ EmailUsage }) {
  private providers: ProviderConfig[] = [
    { id: "mailjet", daily_limit: 200 },
    { id: "resend", daily_limit: 100 },
  ]

  /**
   * Get today's date string in YYYY-MM-DD format
   */
  private getTodayDate(): string {
    return new Date().toISOString().split("T")[0]
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
   * Returns an allocation plan: which emails go to which provider.
   */
  async distributeEmails(emails: string[]): Promise<ProviderAllocation[]> {
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

    // If there are still unallocated emails (all providers exhausted),
    // assign them to the first provider anyway (will likely fail but we track it)
    if (emailIndex < emails.length) {
      const overflow = emails.slice(emailIndex)
      if (allocations.length > 0) {
        allocations[0].emails.push(...overflow)
      } else {
        allocations.push({
          provider: this.providers[0].id,
          emails: overflow,
        })
      }
    }

    return allocations
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
