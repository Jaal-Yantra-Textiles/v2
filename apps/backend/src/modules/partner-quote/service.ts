import { MedusaService } from "@medusajs/framework/utils"
import PartnerQuote from "./models/partner-quote"
import PartnerQuoteLine from "./models/partner-quote-line"

class PartnerQuoteService extends MedusaService({
  PartnerQuote,
  PartnerQuoteLine,
}) {
  /**
   * Look up a quote by the sha256 of its raw token. Returns null when no row
   * matches (unknown or tampered token) — the caller decides whether that is a
   * 404, which keeps "wrong token" and "revoked token" indistinguishable to a
   * prober.
   */
  async findByTokenHash(tokenHash: string) {
    const rows = await this.listPartnerQuotes({ token_hash: tokenHash })
    return rows?.[0] || null
  }

  /**
   * Record a view. Fire-and-forget by contract: the caller must not await this
   * on the render path and must swallow its errors — view tracking has no
   * business turning a buyer's quote page into a 500.
   */
  async recordView(id: string, now: Date) {
    const existing = await this.retrievePartnerQuote(id)
    return this.updatePartnerQuotes({
      id,
      viewed_at: existing?.viewed_at ?? now,
      last_viewed_at: now,
      view_count: (existing?.view_count ?? 0) + 1,
    })
  }
}

export default PartnerQuoteService
