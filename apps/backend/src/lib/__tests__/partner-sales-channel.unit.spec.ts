import {
  isPartnerSalesChannel,
  partnerChannelMetadata,
  planPartnerChannelCleanup,
  type PartnerChannelCleanupFacts,
} from "../partner-sales-channel"

/**
 * #2527 — only partner-created channels are ever cleaned up. The two
 * admin channels below are the real prod pair that had no store on 2026-11-09.
 */

const WORK_ORDERS = { id: "sc_work_orders", name: "Partner Work Orders", metadata: null }
const POS = { id: "sc_pos", name: "DAWIARACAFE", metadata: {} }
const ZOVVY = {
  id: "sc_zovvy",
  name: "Zovvyshop.in - Online Store",
  metadata: partnerChannelMetadata("partner_zovvy"),
}
const LIVE_PARTNER = {
  id: "sc_live",
  name: "GOF - Default",
  metadata: partnerChannelMetadata("partner_gof"),
}

const facts = (over: Partial<PartnerChannelCleanupFacts> = {}): PartnerChannelCleanupFacts => ({
  channels: [WORK_ORDERS, POS, ZOVVY, LIVE_PARTNER],
  live_store_channel_ids: ["sc_live"],
  live_order_ids_by_channel: {},
  ...over,
})

describe("isPartnerSalesChannel", () => {
  it("is true only for the partner_store stamp", () => {
    expect(isPartnerSalesChannel(ZOVVY)).toBe(true)
    expect(isPartnerSalesChannel(WORK_ORDERS)).toBe(false)
    expect(isPartnerSalesChannel(POS)).toBe(false)
    expect(isPartnerSalesChannel({ metadata: { created_by: "admin" } })).toBe(false)
    expect(isPartnerSalesChannel(null)).toBe(false)
  })
})

describe("planPartnerChannelCleanup", () => {
  it("deletes a partner channel no live store uses", () => {
    const plan = planPartnerChannelCleanup(facts())

    expect(plan.delete).toEqual([
      { id: "sc_zovvy", name: "Zovvyshop.in - Online Store", partner_id: "partner_zovvy" },
    ])
  })

  it("never considers admin channels, even with no store", () => {
    const plan = planPartnerChannelCleanup(facts())
    const touched = [...plan.delete, ...plan.skipped].map((c) => c.id)

    expect(touched).not.toContain("sc_work_orders")
    expect(touched).not.toContain("sc_pos")
  })

  it("keeps a partner channel a live store still uses", () => {
    const plan = planPartnerChannelCleanup(facts())

    expect(plan.delete.map((c) => c.id)).not.toContain("sc_live")
  })

  it("skips a channel with orders in flight, and says why", () => {
    const plan = planPartnerChannelCleanup(
      facts({ live_order_ids_by_channel: { sc_zovvy: ["order_1"] } })
    )

    expect(plan.delete).toEqual([])
    expect(plan.skipped[0].id).toBe("sc_zovvy")
    expect(plan.skipped[0].reason).toContain("order_1")
  })
})
