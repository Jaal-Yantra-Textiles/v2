import { compareQuote, type QuoteMoney } from "../lib/compare"

const money = (over: Partial<QuoteMoney> = {}): QuoteMoney => ({
  unit_amount: 1200,
  subtotal: 600_000,
  freight: 21_000,
  landed_total: 621_000,
  // S8 added these as REQUIRED fields and this fixture was not updated, so the
  // branch was red on `check:prod-build` while every unit test passed — jest
  // does not typecheck. Null, not 0: the comparison cases here are about goods
  // and freight, and a 0 would assert a tax answer none of them make.
  tax_total: null,
  // #1447 added `duty_total` the same way, and this fixture is where the
  // omission shows up: red on `check:prod-build`, green on jest.
  duty_total: null,
  import_tax_total: null,
  ddp_fee_total: null,
  gross_total: null,
  ...over,
})

const base = {
  quoted: money(),
  live: money(),
  buyer_changed_inputs: false,
  unusable_reason: null as null | "revoked" | "superseded" | "expired",
  days_until_expiry: 10 as number | null,
}

describe("compareQuote", () => {
  it("collapses to one number when nothing has moved", () => {
    // Two identical numbers under two headings reads as a bug, not as
    // reassurance.
    const r = compareQuote(base)
    expect(r.state).toBe("quoted_only")
    expect(r.show_quoted).toBe(true)
    expect(r.show_live).toBe(false)
    expect(r.landed_delta).toBe(0)
  })

  it("shows both, with a signed delta, once anything differs", () => {
    const r = compareQuote({
      ...base,
      live: money({ landed_total: 640_000, freight: 40_000 }),
    })
    expect(r.state).toBe("show_both")
    expect(r.show_quoted && r.show_live).toBe(true)
    expect(r.landed_delta).toBe(19_000)
    expect(r.explanation).toContain("moved since")
  })

  it("reports a fall as a negative delta rather than an absolute difference", () => {
    const r = compareQuote({
      ...base,
      live: money({ landed_total: 600_000 }),
    })
    expect(r.landed_delta).toBe(-21_000)
  })

  it("shows both when the buyer moved the inputs, even if the numbers match", () => {
    // "What you were quoted" and "what you are looking at" are different
    // questions the moment the buyer changes quantity or destination.
    const r = compareQuote({ ...base, buyer_changed_inputs: true })
    expect(r.state).toBe("show_both")
    expect(r.explanation).toContain("changed the quantity")
  })

  describe("dead and expired links", () => {
    it("prices nothing on a revoked link", () => {
      const r = compareQuote({ ...base, unusable_reason: "revoked" })
      expect(r.state).toBe("dead_link")
      expect(r.show_quoted).toBe(false)
      expect(r.show_live).toBe(false)
      // No disclaimer: there is no estimate on the page to qualify.
      expect(r.disclaimer).toBeNull()
    })

    it("shows the quoted figures but no live number once expired", () => {
      // Recomputing a live number on an expired quote would read as an offer
      // we are still making.
      const r = compareQuote({ ...base, unusable_reason: "expired" })
      expect(r.state).toBe("expired_quoted_only")
      expect(r.show_quoted).toBe(true)
      expect(r.show_live).toBe(false)
      expect(r.landed_delta).toBeNull()
      expect(r.headline).toContain("expired")
    })

    it("shows the quoted figures but no live number once superseded", () => {
      // Same reasoning as expiry: the record of what was said stays, but a
      // recomputed live number would read as an offer still on the table.
      const r = compareQuote({ ...base, unusable_reason: "superseded" })
      expect(r.state).toBe("superseded_quoted_only")
      expect(r.show_quoted).toBe(true)
      expect(r.show_live).toBe(false)
      expect(r.landed_delta).toBeNull()
    })

    it("does not tell a superseded buyer the partner withdrew the quote", () => {
      // #1435: a superseded quote was REPLACED, not pulled. Using the revoked
      // copy would send the buyer into an apologetic conversation instead of
      // simply asking for the current link.
      const superseded = compareQuote({ ...base, unusable_reason: "superseded" })
      expect(superseded.state).not.toBe("dead_link")
      expect(superseded.headline.toLowerCase()).toContain("newer")
      expect(superseded.explanation).not.toContain("withdrawn")
      expect(superseded.explanation.toLowerCase()).toContain("updated quote")
    })

    it("does not tell a buyer to ask for a re-send of a withdrawn quote", () => {
      const revoked = compareQuote({ ...base, unusable_reason: "revoked" })
      const expired = compareQuote({ ...base, unusable_reason: "expired" })
      expect(expired.explanation).toContain("re-send")
      expect(revoked.explanation).not.toContain("re-send")
    })
  })

  describe("partial data", () => {
    it("renders live-only when nothing was frozen", () => {
      const r = compareQuote({ ...base, quoted: null })
      expect(r.state).toBe("quoted_only")
      expect(r.show_live).toBe(true)
      expect(r.show_quoted).toBe(false)
    })

    it("renders quoted-only when the live recompute is unavailable", () => {
      const r = compareQuote({ ...base, live: null })
      expect(r.show_quoted).toBe(true)
      expect(r.show_live).toBe(false)
    })

    it("still returns a disclaimer when it has no numbers at all", () => {
      const r = compareQuote({ ...base, quoted: null, live: null })
      expect(r.show_quoted).toBe(false)
      expect(r.show_live).toBe(false)
      expect(r.disclaimer).toBeTruthy()
    })
  })

  describe("the disclaimer is the anti-binding-offer control", () => {
    it("is present on every state that shows a number", () => {
      const states = [
        compareQuote(base),
        compareQuote({ ...base, buyer_changed_inputs: true }),
        compareQuote({ ...base, unusable_reason: "expired" }),
        compareQuote({ ...base, quoted: null }),
      ]
      for (const r of states) {
        expect(r.disclaimer).toContain("not a binding offer")
      }
    })

    it("is one string, so the page and the email cannot drift", () => {
      const a = compareQuote(base).disclaimer
      const b = compareQuote({ ...base, buyer_changed_inputs: true }).disclaimer
      expect(a).toBe(b)
    })
  })

  describe("expiry notice", () => {
    it("stays quiet with plenty of time left", () => {
      expect(compareQuote(base).expiry_notice).toBeNull()
    })

    it("warns from three days out", () => {
      expect(
        compareQuote({ ...base, days_until_expiry: 3 }).expiry_notice
      ).toContain("3 days")
    })

    it("says 'day', singular, at one", () => {
      const notice = compareQuote({ ...base, days_until_expiry: 1 })
        .expiry_notice
      expect(notice).toContain("1 day.")
      expect(notice).not.toContain("1 days")
    })

    it("says 'today' rather than 'in 0 days'", () => {
      expect(
        compareQuote({ ...base, days_until_expiry: 0 }).expiry_notice
      ).toContain("today")
    })

    it("is null on a link that never expires", () => {
      expect(
        compareQuote({ ...base, days_until_expiry: null }).expiry_notice
      ).toBeNull()
    })

    it("is not repeated on an already-expired quote", () => {
      expect(
        compareQuote({ ...base, unusable_reason: "expired", days_until_expiry: 0 })
          .expiry_notice
      ).toBeNull()
    })
  })
})
