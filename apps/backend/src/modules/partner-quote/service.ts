import { MedusaService } from "@medusajs/framework/utils"
import PartnerQuote from "./models/partner-quote"
import PartnerQuoteLine from "./models/partner-quote-line"
import PartnerQuoteEvent from "./models/partner-quote-event"

class PartnerQuoteService extends MedusaService({
  PartnerQuote,
  PartnerQuoteLine,
  PartnerQuoteEvent,
}) {
  /**
   * Look up a quote by the sha256 of its raw token. Returns null when no row
   * matches (unknown or tampered token) — the caller decides whether that is a
   * 404, which keeps "wrong token" and "revoked token" indistinguishable to a
   * prober.
   */
  async findByTokenHash(tokenHash: string) {
    /**
     * 🔴 Refuse an empty hash rather than asking with it.
     *
     * `listPartnerQuotes({ token_hash: undefined })` is not "no rows" — it is
     * NO FILTER, and it would hand back the first quote in the table. That was
     * survivable while every row was a real quote belonging to somebody; with
     * drafts in the same table it would serve a buyer an unpriced draft, and
     * with any row it is somebody else's quote entirely.
     *
     * Drafts are additionally unreachable here by construction — their
     * `token_hash` is NULL and NULL matches nothing — but that is the second
     * line, not the first.
     */
    if (!tokenHash) return null

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
    const updated = await this.updatePartnerQuotes({
      id,
      viewed_at: existing?.viewed_at ?? now,
      last_viewed_at: now,
      view_count: (existing?.view_count ?? 0) + 1,
    })

    // Only the FIRST view earns a timeline entry. A quote link is deliberately
    // multi-view — forwarding it around a procurement team is the use case — so
    // logging every hit would bury the events that matter under a wall of
    // identical rows. The running total already lives on `view_count`.
    if (!existing?.viewed_at) {
      await this.recordEvent({
        quote_id: id,
        type: "viewed",
        actor_type: "buyer",
        message: "The buyer opened the quote for the first time.",
      }).catch(() => {})
    }

    return updated
  }

  /**
   * Append one activity row.
   *
   * 🔑 Callers treat this as best-effort and swallow its failure: activity
   * logging must never turn a buyer's page or a partner's mint into a 500. That
   * makes a missing row possible, which is the right trade — a lost log line is
   * recoverable, a failed mint is not.
   */
  async recordEvent(input: {
    quote_id: string
    type: string
    actor_type: "partner" | "admin" | "buyer" | "system"
    actor_id?: string | null
    message?: string | null
    data?: Record<string, unknown> | null
  }) {
    return this.createPartnerQuoteEvents({
      quote_id: input.quote_id,
      type: input.type,
      actor_type: input.actor_type,
      actor_id: input.actor_id ?? null,
      message: input.message ?? null,
      data: input.data ?? null,
    })
  }

  /** The timeline, newest first. */
  async listEvents(quoteId: string) {
    const events = await this.listPartnerQuoteEvents({ quote_id: quoteId })
    return [...(events ?? [])].sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }
}

export default PartnerQuoteService
