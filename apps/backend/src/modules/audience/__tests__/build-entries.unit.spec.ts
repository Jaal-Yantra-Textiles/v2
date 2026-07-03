import { buildAudienceEntries, summarizeEntries } from "../build-entries"

describe("buildAudienceEntries", () => {
  it("dedupes by email and unions groups/tags across sources", () => {
    const out = buildAudienceEntries([
      { member_type: "person", member_id: "p1", email: "Jane@X.com", metadata: { metadata_district: "N" }, sub_active: true },
      { member_type: "customer", member_id: "c1", email: "jane@x.com", metadata: {} },
    ])
    expect(out).toHaveLength(1)
    const e = out[0]
    expect(e.email).toBe("jane@x.com")
    // person wins as primary (priority) → source weaver-directory
    expect(e.member_type).toBe("person")
    expect(e.source).toBe("weaver-directory")
    // unioned across both records
    expect(e.tags).toEqual(expect.arrayContaining(["weaver-directory", "subscriber", "customer"]))
    expect(e.groups).toEqual(expect.arrayContaining(["weaver-directory", "customers"]))
  })

  it("skips invalid / empty emails", () => {
    const out = buildAudienceEntries([
      { member_type: "person", member_id: "p1", email: "nope" },
      { member_type: "lead", member_id: "l1", email: "" },
      { member_type: "customer", member_id: "c1", email: "ok@x.com" },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].email).toBe("ok@x.com")
  })

  it("bounced on any record makes the merged entry not mailable", () => {
    const out = buildAudienceEntries([
      { member_type: "person", member_id: "p1", email: "a@x.com", metadata: {}, sub_active: true },
      { member_type: "customer", member_id: "c1", email: "a@x.com", metadata: { bounced: true } },
    ])
    expect(out[0].mailable).toBe(false)
    expect(out[0].tags).toContain("bounced")
  })

  it("keeps distinct emails separate", () => {
    const out = buildAudienceEntries([
      { member_type: "customer", member_id: "c1", email: "a@x.com" },
      { member_type: "customer", member_id: "c2", email: "b@x.com" },
    ])
    expect(out.map((e) => e.email).sort()).toEqual(["a@x.com", "b@x.com"])
  })
})

describe("summarizeEntries", () => {
  it("counts by source, tag, member_type + mailable", () => {
    const s = summarizeEntries([
      { email: "a@x.com", member_type: "person", member_id: "p", first_name: null, last_name: null, source: "organic", groups: ["organic"], tags: ["organic", "subscriber"], mailable: true },
      { email: "b@x.com", member_type: "customer", member_id: "c", first_name: null, last_name: null, source: "customer", groups: ["customers"], tags: ["customer"], mailable: false },
    ])
    expect(s.total).toBe(2)
    expect(s.mailable).toBe(1)
    expect(s.bySource).toEqual({ organic: 1, customer: 1 })
    expect(s.byMemberType).toEqual({ person: 1, customer: 1 })
    expect(s.byTag.subscriber).toBe(1)
  })
})
