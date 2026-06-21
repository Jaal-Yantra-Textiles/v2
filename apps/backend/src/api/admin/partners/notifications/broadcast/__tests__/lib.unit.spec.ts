import {
  selectBroadcastPartnerIds,
  summarizeBroadcast,
  type PartnerLite,
  type BroadcastResult,
} from "../lib"

/**
 * Unit coverage for the admin partner-broadcast pure helpers (#453).
 * No DI / notification module involved — just target resolution + summary.
 */

const partners: PartnerLite[] = [
  { id: "p_1", status: "active" },
  { id: "p_2", status: "pending" },
  { id: "p_3", status: "inactive" },
  { id: "p_4", status: "active" },
]

describe("selectBroadcastPartnerIds", () => {
  it("returns all partner ids when no filter is given", () => {
    expect(selectBroadcastPartnerIds(partners, {})).toEqual([
      "p_1",
      "p_2",
      "p_3",
      "p_4",
    ])
  })

  it("filters by status when no explicit ids are given", () => {
    expect(selectBroadcastPartnerIds(partners, { status: "active" })).toEqual([
      "p_1",
      "p_4",
    ])
  })

  it("uses explicit partner_ids and ignores status filtering", () => {
    expect(
      selectBroadcastPartnerIds(partners, {
        partner_ids: ["p_2", "p_3"],
        status: "active",
      })
    ).toEqual(["p_2", "p_3"])
  })

  it("drops explicit ids that are not known partners", () => {
    expect(
      selectBroadcastPartnerIds(partners, {
        partner_ids: ["p_1", "p_unknown", "p_4"],
      })
    ).toEqual(["p_1", "p_4"])
  })

  it("de-duplicates explicit ids while preserving first-seen order", () => {
    expect(
      selectBroadcastPartnerIds(partners, {
        partner_ids: ["p_4", "p_1", "p_4"],
      })
    ).toEqual(["p_4", "p_1"])
  })

  it("returns an empty array when no partners match the status filter", () => {
    expect(
      selectBroadcastPartnerIds([{ id: "p_1", status: "active" }], {
        status: "pending",
      })
    ).toEqual([])
  })

  it("treats an empty partner_ids array as 'broadcast to all'", () => {
    expect(
      selectBroadcastPartnerIds(partners, { partner_ids: [] })
    ).toEqual(["p_1", "p_2", "p_3", "p_4"])
  })
})

describe("summarizeBroadcast", () => {
  it("counts sent and failed and lists failed ids", () => {
    const results: BroadcastResult[] = [
      { partner_id: "p_1", ok: true },
      { partner_id: "p_2", ok: false },
      { partner_id: "p_3", ok: true },
      { partner_id: "p_4", ok: false },
    ]
    expect(summarizeBroadcast(results)).toEqual({
      total: 4,
      sent: 2,
      failed: 2,
      failures: ["p_2", "p_4"],
    })
  })

  it("handles an all-success run", () => {
    const results: BroadcastResult[] = [
      { partner_id: "p_1", ok: true },
      { partner_id: "p_2", ok: true },
    ]
    expect(summarizeBroadcast(results)).toEqual({
      total: 2,
      sent: 2,
      failed: 0,
      failures: [],
    })
  })

  it("handles an empty run", () => {
    expect(summarizeBroadcast([])).toEqual({
      total: 0,
      sent: 0,
      failed: 0,
      failures: [],
    })
  })
})
