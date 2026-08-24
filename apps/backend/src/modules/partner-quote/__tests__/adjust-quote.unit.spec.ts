import {
  adjustmentNeedsNotice,
  diffAdjustment,
} from "../lib/adjust-quote"

/**
 * Correcting a quote in place, before the buyer accepts.
 *
 * A minted quote had two futures — accepted or revoked — so a mis-quoted
 * freight could only be fixed by re-minting, which emails the buyer a NEW
 * number for what is, to them, a correction to the document they are reading.
 */
const QUOTE = {
  id: "pq_1",
  quoted_freight: 35,
  quoted_subtotal: 598.52,
  quoted_tax_total: 0,
  partner_note: "original note",
  expires_at: new Date("2026-09-23T13:36:28.305Z"),
}

describe("diffAdjustment", () => {
  it("reports nothing when the caller sent nothing", () => {
    expect(diffAdjustment(QUOTE, {})).toEqual([])
  })

  it("🔴 reports nothing when the values sent are what is already stored", () => {
    // A no-op must stay a no-op. Without this, saving a form nobody edited
    // stamps `adjusted_at`, writes a timeline entry, and — worst — could mail
    // the buyer about a change that did not happen.
    const diffs = diffAdjustment(QUOTE, {
      freight_amount: 35,
      partner_note: "original note",
      expires_at: new Date("2026-09-23T13:36:28.305Z"),
    })
    expect(diffs).toEqual([])
  })

  it("reports a freight change with both ends", () => {
    expect(diffAdjustment(QUOTE, { freight_amount: 52 })).toEqual([
      { field: "quoted_freight", from: 35, to: 52 },
    ])
  })

  it("distinguishes an omitted key from an explicit null", () => {
    // `undefined` means "leave it alone"; the note being cleared is a real
    // change the buyer would see.
    expect(diffAdjustment(QUOTE, { partner_note: null })).toEqual([
      { field: "partner_note", from: "original note", to: null },
    ])
    expect(diffAdjustment(QUOTE, {})).toEqual([])
  })

  it("compares expiry as an instant, not as a string", () => {
    // The same moment written two ways is not a change. A string comparison
    // would call it one and re-date the price list for nothing.
    const same = diffAdjustment(QUOTE, {
      expires_at: "2026-09-23T13:36:28.305Z",
    })
    expect(same).toEqual([])

    const moved = diffAdjustment(QUOTE, {
      expires_at: "2026-10-23T13:36:28.305Z",
    })
    expect(moved).toHaveLength(1)
    expect(moved[0].field).toBe("expires_at")
  })

  it("collects several changes at once", () => {
    const diffs = diffAdjustment(QUOTE, {
      freight_amount: 52,
      partner_note: "corrected note",
    })
    expect(diffs.map((d) => d.field).sort()).toEqual([
      "partner_note",
      "quoted_freight",
    ])
  })
})

describe("adjustmentNeedsNotice", () => {
  it("🔴 emails when the freight goes UP", () => {
    // The buyer may have done their margin arithmetic on the old figure.
    // Letting them discover a rise silently is how a correction reads as a
    // bait-and-switch.
    const diffs = diffAdjustment(QUOTE, { freight_amount: 52 })
    expect(adjustmentNeedsNotice(diffs)).toBe(true)
  })

  it("stays silent when the freight goes DOWN", () => {
    // A reduction in the buyer's favour needs no interruption — the page is
    // always live, so they see it next time they open the link.
    const diffs = diffAdjustment(QUOTE, { freight_amount: 28 })
    expect(adjustmentNeedsNotice(diffs)).toBe(false)
  })

  it("never emails for a note or expiry change alone", () => {
    // Re-sending a quote because somebody fixed a typo trains a buyer to
    // ignore the mails that matter.
    const noteOnly = diffAdjustment(QUOTE, { partner_note: "typo fixed" })
    expect(adjustmentNeedsNotice(noteOnly)).toBe(false)

    const expiryOnly = diffAdjustment(QUOTE, {
      expires_at: "2026-10-23T13:36:28.305Z",
    })
    expect(adjustmentNeedsNotice(expiryOnly)).toBe(false)
  })

  it("is false on an empty diff", () => {
    expect(adjustmentNeedsNotice([])).toBe(false)
  })
})
