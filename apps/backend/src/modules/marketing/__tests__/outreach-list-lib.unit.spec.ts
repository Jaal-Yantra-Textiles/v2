import {
  filterAndPaginateOutreach,
  type OutreachListRow,
} from "../outreach-list-lib"

const rows: OutreachListRow[] = [
  { id: "1", recipient_email: "ana@acme.com", recipient_name: "Ana", company: "Acme", campaign: "q3-winbacks", status: "sent", channel: "email" },
  { id: "2", recipient_email: "bob@globex.com", recipient_name: "Bob", company: "Globex", campaign: "q3-winbacks", status: "replied", channel: "email" },
  { id: "3", recipient_email: "cal@acme.com", recipient_name: "Cal", company: "Acme", campaign: "exec-2026", status: "bounced", channel: "whatsapp" },
  { id: "4", recipient_email: "deb@initech.com", recipient_name: "Deb", company: "Initech", campaign: "exec-2026", status: "queued", channel: "manual" },
  { id: "5", recipient_email: "evan@acme.com", recipient_name: "Evan", company: "Acme", campaign: "q3-winbacks", status: "opened", channel: "email" },
]

describe("filterAndPaginateOutreach", () => {
  it("returns all rows with defaults", () => {
    const r = filterAndPaginateOutreach(rows)
    expect(r.count).toBe(5)
    expect(r.items).toHaveLength(5)
    expect(r.offset).toBe(0)
    expect(r.limit).toBe(50)
  })

  it("filters by status exactly", () => {
    const r = filterAndPaginateOutreach(rows, { status: "replied" })
    expect(r.count).toBe(1)
    expect(r.items[0].id).toBe("2")
  })

  it("filters by campaign", () => {
    const r = filterAndPaginateOutreach(rows, { campaign: "exec-2026" })
    expect(r.count).toBe(2)
    expect(r.items.map((i) => i.id).sort()).toEqual(["3", "4"])
  })

  it("filters by channel", () => {
    const r = filterAndPaginateOutreach(rows, { channel: "whatsapp" })
    expect(r.count).toBe(1)
    expect(r.items[0].id).toBe("3")
  })

  it("q matches email, name, company and campaign (case-insensitive)", () => {
    expect(filterAndPaginateOutreach(rows, { q: "ACME" }).count).toBe(3) // company
    expect(filterAndPaginateOutreach(rows, { q: "bob" }).count).toBe(1) // name
    expect(filterAndPaginateOutreach(rows, { q: "globex.com" }).count).toBe(1) // email
    expect(filterAndPaginateOutreach(rows, { q: "exec-2026" }).count).toBe(2) // campaign
  })

  it("combines filters with AND", () => {
    const r = filterAndPaginateOutreach(rows, { q: "acme", status: "opened" })
    expect(r.count).toBe(1)
    expect(r.items[0].id).toBe("5")
  })

  it("count is total matched, NOT per-page (the #484 regression)", () => {
    // 3 Acme rows, page size 2 → count must stay 3, items only 2
    const r = filterAndPaginateOutreach(rows, { q: "acme", limit: 2 })
    expect(r.count).toBe(3)
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => i.id)).toEqual(["1", "3"])
  })

  it("paginates with offset over the filtered set", () => {
    const r = filterAndPaginateOutreach(rows, { q: "acme", offset: 2, limit: 2 })
    expect(r.count).toBe(3)
    expect(r.items.map((i) => i.id)).toEqual(["5"])
  })

  it("clamps invalid offset/limit to safe defaults", () => {
    const r = filterAndPaginateOutreach(rows, { offset: -5, limit: 0 })
    expect(r.offset).toBe(0)
    expect(r.limit).toBe(50)
    const capped = filterAndPaginateOutreach(rows, { limit: 9999 })
    expect(capped.limit).toBe(200)
  })

  it("blank q is ignored (not treated as a filter)", () => {
    expect(filterAndPaginateOutreach(rows, { q: "   " }).count).toBe(5)
  })

  it("handles empty/nullish input safely", () => {
    expect(filterAndPaginateOutreach([] as OutreachListRow[]).count).toBe(0)
    expect(
      filterAndPaginateOutreach(undefined as unknown as OutreachListRow[]).count
    ).toBe(0)
  })
})
