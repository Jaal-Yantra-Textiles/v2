import {
  assessRunQuantityCorrection,
  correctionConsequenceNote,
} from "../run-quantity-correction"

/**
 * When a run's agreed quantity may still be corrected (#1695).
 *
 * The case these exist for: run `prod_run_01M0YVV2M7H7BZWJF5WN4MW4ZR` was sent
 * for 2 and the partner made 3. A ₹1,400 DRAFT submission stood against it —
 * unpaid, unclaimed, uncontested — and the correction was impossible from
 * either end. The run refused because work had begun; the payment refused
 * because the run said 2. Neither half was wrong on its own terms and together
 * they deadlocked, so an ops job had to break it.
 *
 * 🔑 The freeze point belongs at SETTLEMENT, not at the start of work.
 */

const run = {
  quantity: 2,
  produced_quantity: 3,
  short_closed_at: null,
  cost_type: "per_unit",
  partner_cost_estimate: 700,
}

const draftClaim = {
  claimed_quantity: 2,
  claimed_wholly: false,
  claims: [{ submission_id: "ps_draft", submission_status: "Draft" }],
}

describe("assessRunQuantityCorrection — the freeze point", () => {
  it("🔴 allows the correction that deadlocked: a Draft claim does not freeze the run", () => {
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 3,
      tally: draftClaim,
      claims_readable: true,
    })

    expect(a.allowed).toBe(true)
    expect(a.refusal).toBeNull()
    expect(a.newly_claimable).toBe(1)
    expect(a.worth).toBe(700)
  })

  it("allows it when nothing has been claimed at all", () => {
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 5,
      tally: null,
      claims_readable: true,
    })
    expect(a.allowed).toBe(true)
    expect(a.newly_claimable).toBe(3)
  })

  it.each([
    ["Pending", "ps_1"],
    ["Under_Review", "ps_2"],
    ["Approved", "ps_3"],
    ["Paid", "ps_4"],
  ])("refuses once a %s claim stands — that is a reversing entry, not an edit", (status, id) => {
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 3,
      tally: {
        claimed_quantity: 2,
        claimed_wholly: false,
        claims: [{ submission_id: id, submission_status: status }],
      },
      claims_readable: true,
    })

    expect(a.allowed).toBe(false)
    expect(a.refusal).toContain(id)
    expect(a.frozen_by).toHaveLength(1)
  })

  it("a Rejected claim does not freeze the run", () => {
    // `foldRunClaimTallies` already drops Rejected lines upstream — this pins
    // that a tally arriving without them leaves the run editable, so the two
    // halves cannot drift into disagreeing about what a live claim is.
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 3,
      tally: { claimed_quantity: 0, claimed_wholly: false, claims: [] },
      claims_readable: true,
    })
    expect(a.allowed).toBe(true)
  })
})

describe("assessRunQuantityCorrection — lowering is not the mirror of raising", () => {
  it("refuses a lowering under what has been claimed", () => {
    const a = assessRunQuantityCorrection({
      run: { ...run, quantity: 9 },
      next_quantity: 1,
      tally: draftClaim,
      claims_readable: true,
    })
    expect(a.allowed).toBe(false)
    expect(a.refusal).toMatch(/retroactive overclaim/i)
  })

  it("allows a lowering that stays at or above the claims", () => {
    const a = assessRunQuantityCorrection({
      run: { ...run, quantity: 9 },
      next_quantity: 2,
      tally: draftClaim,
      claims_readable: true,
    })
    expect(a.allowed).toBe(true)
    // Nothing becomes newly claimable by lowering — and it must never report a
    // negative, which downstream would read as room.
    expect(a.newly_claimable).toBe(0)
  })

  it("🔴 refuses a lowering when a claim has no attributable quantity", () => {
    // A line naming several runs carries their SUM. There is no number to
    // compare against, so the lowering cannot be PROVEN safe — refuse rather
    // than assume zero.
    const a = assessRunQuantityCorrection({
      run: { ...run, quantity: 9 },
      next_quantity: 2,
      tally: {
        claimed_quantity: 0,
        claimed_wholly: true,
        claims: [{ submission_id: "ps_multi", submission_status: "Draft" }],
      },
      claims_readable: true,
    })
    expect(a.allowed).toBe(false)
    expect(a.refusal).toMatch(/cannot be shown to be safe/i)
  })

  it("still allows a RAISE when a claim has no attributable quantity", () => {
    // Raising is additive — it invalidates nothing, whatever was claimed.
    const a = assessRunQuantityCorrection({
      run: { ...run, quantity: 2 },
      next_quantity: 5,
      tally: {
        claimed_quantity: 0,
        claimed_wholly: true,
        claims: [{ submission_id: "ps_multi", submission_status: "Draft" }],
      },
      claims_readable: true,
    })
    expect(a.allowed).toBe(true)
  })

  it("open-ended is never a lowering", () => {
    const a = assessRunQuantityCorrection({
      run: { ...run, quantity: 9 },
      next_quantity: null,
      tally: draftClaim,
      claims_readable: true,
    })
    expect(a.allowed).toBe(true)
    expect(a.ceiling_after).toBeNull()
    expect(correctionConsequenceNote(a)).toMatch(/OPEN-ENDED/)
  })
})

describe("assessRunQuantityCorrection — refuse blind", () => {
  it("🔴 an unreadable claim lookup refuses, and does NOT read as zero", () => {
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 3,
      tally: null,
      claims_readable: false,
    })
    expect(a.allowed).toBe(false)
    expect(a.refusal).toMatch(/blind/i)
  })

  it("refuses blind even for a raise", () => {
    // The raise itself is safe, but the ceiling is money-bearing and the
    // consequence cannot be stated. An outage must not read as headroom.
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 99,
      tally: null,
      claims_readable: false,
    })
    expect(a.allowed).toBe(false)
  })
})

describe("correctionConsequenceNote", () => {
  it("always names what becomes claimable and what it is worth", () => {
    const a = assessRunQuantityCorrection({
      run,
      next_quantity: 3,
      tally: draftClaim,
      claims_readable: true,
    })
    const note = correctionConsequenceNote(a)
    expect(note).toContain("ceiling 2 → 3")
    expect(note).toContain("already claimed 2")
    expect(note).toContain("newly claimable 1")
    expect(note).toContain("700")
  })

  it("reads the ceiling of a SHORT-CLOSED run from what was produced", () => {
    // The ceiling is not the raw quantity field, so the note must come from
    // `runBillableCeiling` — a run short-closed at 7 of 9 has a ceiling of 7,
    // and a correction reported against 9 would overstate what it opens up.
    const a = assessRunQuantityCorrection({
      run: {
        quantity: 9,
        produced_quantity: 7,
        short_closed_at: "2026-08-20T00:00:00Z",
        cost_type: "per_unit",
        partner_cost_estimate: 700,
      },
      next_quantity: 12,
      tally: { claimed_quantity: 0, claimed_wholly: false, claims: [] },
      claims_readable: true,
    })
    expect(a.ceiling_before).toBe(7)
    expect(a.ceiling_after).toBe(7)
    expect(a.newly_claimable).toBe(0)
  })
})
