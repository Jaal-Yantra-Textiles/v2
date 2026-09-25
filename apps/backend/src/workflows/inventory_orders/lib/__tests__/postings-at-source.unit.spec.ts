import { classifyPostingLine, type PostingLineInput } from "../postings-at-source"

const base: PostingLineInput = {
  line_id: "l1",
  item_id: "i1",
  name: "Eri Silk",
  price: 895,
  received: 10,
  stocked_at_source: 0,
  stocked_at_destination: 10,
  receipt_posted_at_source: 0,
}

describe("classifyPostingLine (#2286 audit)", () => {
  it("ok: the destination holds what was received", () => {
    expect(classifyPostingLine(base).verdict).toBe("ok")
  })

  it("confirmed: a receipt row posted at the source, whatever the levels say", () => {
    const r = classifyPostingLine({ ...base, receipt_posted_at_source: 10, stocked_at_destination: 10 })
    expect(r.verdict).toBe("confirmed")
    expect(r.misplaced).toBe(10)
    expect(r.value).toBe(8950)
  })

  it("likely: received, the destination is short, and the source holds stock", () => {
    const r = classifyPostingLine({ ...base, stocked_at_destination: 0, stocked_at_source: 25 })
    expect(r.verdict).toBe("likely")
    // Only what the destination is missing, never more than was received.
    expect(r.misplaced).toBe(10)
  })

  it("destination short but the source holds nothing: consumed or moved on, not misplaced", () => {
    expect(classifyPostingLine({ ...base, stocked_at_destination: 2, stocked_at_source: 0 }).verdict).toBe("ok")
  })

  it("nothing received: nothing to judge", () => {
    expect(classifyPostingLine({ ...base, received: 0 }).verdict).toBe("not_received")
  })
})
