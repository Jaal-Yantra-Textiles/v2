import {
  planAudienceEntryWrites,
  type AudienceEntryDraft,
  type ExistingAudienceEntry,
} from "../build-entries"

const draft = (over: Partial<AudienceEntryDraft> = {}): AudienceEntryDraft => ({
  email: "jane@x.com",
  member_type: "person",
  member_id: "p1",
  first_name: "Jane",
  last_name: "Doe",
  source: "weaver-directory",
  groups: ["weaver-directory"],
  tags: ["weaver-directory", "subscriber"],
  mailable: true,
  ...over,
})

const existing = (over: Partial<ExistingAudienceEntry> = {}): ExistingAudienceEntry => ({
  id: "aud_entry_1",
  email: "jane@x.com",
  member_type: "person",
  member_id: "p1",
  first_name: "Jane",
  last_name: "Doe",
  source: "weaver-directory",
  groups: ["weaver-directory"],
  tags: ["weaver-directory", "subscriber"],
  mailable: true,
  ...over,
})

describe("planAudienceEntryWrites", () => {
  it("creates entries whose email is not yet persisted", () => {
    const plan = planAudienceEntryWrites([draft({ email: "new@x.com" })], [])
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.unchanged).toBe(0)
    expect(plan.toCreate[0]).not.toHaveProperty("id")
    expect(plan.toCreate[0].email).toBe("new@x.com")
  })

  it("skips a persisted entry whose content is identical (the convergence guard)", () => {
    const plan = planAudienceEntryWrites([draft()], [existing()])
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.unchanged).toBe(1)
  })

  it("treats reordered groups/tags as unchanged (order-independent)", () => {
    const plan = planAudienceEntryWrites(
      [draft({ tags: ["subscriber", "weaver-directory"], groups: ["weaver-directory"] })],
      [existing({ tags: ["weaver-directory", "subscriber"] })]
    )
    expect(plan.unchanged).toBe(1)
    expect(plan.toUpdate).toHaveLength(0)
  })

  it("updates only when a comparable field actually differs", () => {
    const changedName = planAudienceEntryWrites([draft({ last_name: "Smith" })], [existing()])
    expect(changedName.toUpdate).toHaveLength(1)
    expect(changedName.toUpdate[0].id).toBe("aud_entry_1")
    expect(changedName.toUpdate[0].last_name).toBe("Smith")

    const changedTags = planAudienceEntryWrites([draft({ tags: ["weaver-directory", "bounced"] })], [existing()])
    expect(changedTags.toUpdate).toHaveLength(1)

    const changedMailable = planAudienceEntryWrites([draft({ mailable: false })], [existing()])
    expect(changedMailable.toUpdate).toHaveLength(1)
  })

  it("treats an existing row with null mailable as the default (true)", () => {
    const plan = planAudienceEntryWrites([draft({ mailable: true })], [existing({ mailable: null })])
    expect(plan.unchanged).toBe(1)
    expect(plan.toUpdate).toHaveLength(0)
  })

  it("matches existing rows by lowercased email", () => {
    const plan = planAudienceEntryWrites([draft({ email: "jane@x.com" })], [existing({ email: "JANE@X.com" })])
    expect(plan.unchanged).toBe(1)
    expect(plan.toCreate).toHaveLength(0)
  })

  it("mixes create / update / unchanged across a batch", () => {
    const drafts = [
      draft({ email: "a@x.com" }), // unchanged
      draft({ email: "b@x.com", last_name: "Changed" }), // update
      draft({ email: "c@x.com" }), // create
    ]
    const existingRows = [
      existing({ id: "aud_a", email: "a@x.com" }),
      existing({ id: "aud_b", email: "b@x.com" }),
    ]
    const plan = planAudienceEntryWrites(drafts, existingRows)
    expect(plan.toCreate.map((r) => r.email)).toEqual(["c@x.com"])
    expect(plan.toUpdate.map((r) => r.id)).toEqual(["aud_b"])
    expect(plan.unchanged).toBe(1)
  })
})
