import { checkCompletionOutput } from "../complete-production-run"

/**
 * The hole this closes: `produced_quantity` was optional at completion, so a
 * run could be marked `completed` with the output field null — and every
 * downstream reader (cost summary, payout, provenance, order fulfilment) then
 * falls back to the ORDERED quantity and assumes it was all made. That silent
 * substitution is the untouched cause behind the #1248 thread.
 */
describe("checkCompletionOutput", () => {
  it("accepts a full completion", () => {
    expect(
      checkCompletionOutput({ assigned: 10, produced: 10 })
    ).toEqual({ ok: true, shortfall: 0 })
  })

  it("REFUSES a completion that never says what was made", () => {
    const r = checkCompletionOutput({ assigned: 10 })

    expect(r.ok).toBe(false)
    // The message has to name the number, or the operator cannot act on it.
    expect((r as any).reason).toContain("10 were ordered")
  })

  it("counts rejects as accounted-for output, because they ARE output", () => {
    // 9 good + 1 rejected against an order of 10 is a complete, honest
    // completion. Requiring produced >= ordered would make it impossible to
    // report a reject truthfully.
    expect(
      checkCompletionOutput({ assigned: 10, produced: 9, rejected: 1 })
    ).toEqual({ ok: true, shortfall: 0 })
  })

  it("REFUSES a bare shortfall — the missing units are unexplained", () => {
    const r = checkCompletionOutput({ assigned: 10, produced: 9 })

    expect(r.ok).toBe(false)
    expect((r as any).reason).toContain("9 of 10")
  })

  it("allows a CLAIMED shortfall that carries an explanation", () => {
    const r = checkCompletionOutput({
      assigned: 10,
      produced: 8,
      allowShortfall: true,
      notes: "Fabric ran out at 8 pieces",
    })

    expect(r).toEqual({ ok: true, shortfall: 2 })
  })

  it("REFUSES allow_shortfall used as a bare checkbox", () => {
    // Without this, the escape hatch is just an off switch for the gate.
    const r = checkCompletionOutput({
      assigned: 10,
      produced: 8,
      allowShortfall: true,
    })

    expect(r.ok).toBe(false)
    expect((r as any).reason).toContain("needs an explanation")
  })

  it("takes a rejection reason as the explanation too", () => {
    const r = checkCompletionOutput({
      assigned: 10,
      produced: 8,
      allowShortfall: true,
      rejectionReason: "fabric_flaw",
    })

    expect(r.ok).toBe(true)
  })

  it("treats whitespace as no explanation at all", () => {
    const r = checkCompletionOutput({
      assigned: 10,
      produced: 8,
      allowShortfall: true,
      notes: "   ",
    })

    expect(r.ok).toBe(false)
  })

  it("accepts overproduction — more than ordered is not a shortfall", () => {
    expect(checkCompletionOutput({ assigned: 10, produced: 12 })).toEqual({
      ok: true,
      shortfall: 0,
    })
  })

  it("accepts a zero-output completion when it is claimed and explained", () => {
    // A run that produced nothing is a real outcome; it just may not be silent.
    const r = checkCompletionOutput({
      assigned: 10,
      produced: 0,
      allowShortfall: true,
      notes: "Batch scrapped before cutting",
    })

    expect(r).toEqual({ ok: true, shortfall: 10 })
  })

  it("REFUSES a negative produced quantity", () => {
    expect(checkCompletionOutput({ assigned: 10, produced: -1 }).ok).toBe(false)
  })

  it("enforces nothing on a run with no ordered quantity", () => {
    // Older runs were created without one. Inventing a requirement for them
    // would block completions over data that was never captured.
    expect(checkCompletionOutput({ assigned: 0, produced: null })).toEqual({
      ok: true,
      shortfall: 0,
    })
    expect(checkCompletionOutput({ assigned: null, produced: null })).toEqual({
      ok: true,
      shortfall: 0,
    })
  })

  it("treats an unreadable produced_quantity as unstated, not as zero", () => {
    // Reading NaN as 0 would turn a broken payload into a silent "made none".
    expect(
      checkCompletionOutput({ assigned: 5, produced: Number.NaN }).ok
    ).toBe(false)
  })
})
