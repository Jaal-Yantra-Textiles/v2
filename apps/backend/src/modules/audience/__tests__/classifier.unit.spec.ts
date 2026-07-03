import { classifyContact } from "../classifier"

describe("audience classifier", () => {
  it("customer → customer source/group/tag, mailable unconditionally", () => {
    const c = classifyContact({ member_type: "customer", email: "c@x.com", metadata: {} })
    expect(c.source).toBe("customer")
    expect(c.groups).toEqual(["customers"])
    expect(c.tags).toContain("customer")
    expect(c.mailable).toBe(true)
  })

  it("lead → ad-lead", () => {
    const c = classifyContact({ member_type: "lead", email: "l@x.com" })
    expect(c.source).toBe("ad-lead")
    expect(c.groups).toEqual(["ad-leads"])
    expect(c.tags).toContain("ad-lead")
  })

  it("person with weaver metadata → weaver-directory (+gi tag)", () => {
    const c = classifyContact({
      member_type: "person",
      email: "w@x.com",
      metadata: { metadata_district: "Nadia", metadata_is_gi_product: "yes" },
      sub_active: true,
    })
    expect(c.source).toBe("weaver-directory")
    expect(c.tags).toEqual(expect.arrayContaining(["weaver-directory", "gi-product", "subscriber"]))
  })

  it("person imported on the bulk-import day (no weaver meta) still → weaver-directory", () => {
    const c = classifyContact({
      member_type: "person",
      email: "w2@x.com",
      metadata: {},
      created_at: "2025-07-10T12:00:00.000Z",
    })
    expect(c.source).toBe("weaver-directory")
  })

  it("person, later date, no weaver meta → organic", () => {
    const c = classifyContact({
      member_type: "person",
      email: "o@x.com",
      metadata: {},
      created_at: "2026-03-22T00:00:00.000Z",
      sub_active: true,
    })
    expect(c.source).toBe("organic")
    expect(c.tags).toEqual(expect.arrayContaining(["organic", "subscriber"]))
  })

  it("onboarding-finished person is tagged", () => {
    const c = classifyContact({
      member_type: "person",
      email: "f@x.com",
      metadata: { metadata_district: "X" },
      state: "Onboarding Finished",
      sub_active: true,
    })
    expect(c.tags).toContain("onboarding-finished")
  })

  it("bounced/unsubscribed persons are tagged and NOT mailable", () => {
    const bounced = classifyContact({
      member_type: "person", email: "b@x.com", metadata: { bounced: true }, sub_active: true,
    })
    expect(bounced.tags).toContain("bounced")
    expect(bounced.mailable).toBe(false)

    const unsub = classifyContact({
      member_type: "person", email: "u@x.com", metadata: { unsubscribed: true }, sub_active: true,
    })
    expect(unsub.tags).toContain("unsubscribed")
    expect(unsub.mailable).toBe(false)
  })

  it("person without an active sub is not mailable (no active email subscription)", () => {
    const c = classifyContact({ member_type: "person", email: "n@x.com", metadata: {}, sub_active: false })
    expect(c.mailable).toBe(false)
    expect(c.tags).not.toContain("subscriber")
  })

  it("bounced customer is not mailable", () => {
    const c = classifyContact({ member_type: "customer", email: "bc@x.com", metadata: { bounced: true } })
    expect(c.mailable).toBe(false)
  })
})
