import {
  buildEmailLeadKey,
  buildEmailSnippet,
  buildLeadInputFromEmail,
  DEFAULT_LEAD_FOLDERS,
  isLeadEmail,
  leadFollowupAlreadyNudged,
  parseFromAddress,
  resolveLeadFolders,
  selectLeadEmailsToIngest,
  selectLeadsNeedingFollowup,
  splitName,
} from "../email-lead"

const NOW = new Date("2026-06-24T10:00:00.000Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

const email = (over: Record<string, any> = {}) => ({
  id: "inb_1",
  imap_uid: "100",
  message_id: "<msg-1@mail.com>",
  from_address: "Jane Doe <jane@buyer.com>",
  subject: "Interested in bulk fabric",
  text_body: "Hi, we'd like a quote for 500m of cotton.",
  folder: "Leads",
  status: "received",
  received_at: daysAgo(1),
  metadata: {},
  ...over,
})

describe("resolveLeadFolders", () => {
  it("defaults when empty/undefined", () => {
    expect(resolveLeadFolders()).toEqual(DEFAULT_LEAD_FOLDERS)
    expect(resolveLeadFolders("")).toEqual(DEFAULT_LEAD_FOLDERS)
    expect(resolveLeadFolders([])).toEqual(DEFAULT_LEAD_FOLDERS)
  })
  it("splits a comma string and trims", () => {
    expect(resolveLeadFolders("Leads, Sales Inbox ,VIP")).toEqual([
      "Leads",
      "Sales Inbox",
      "VIP",
    ])
  })
  it("accepts an array", () => {
    expect(resolveLeadFolders(["A", "B"])).toEqual(["A", "B"])
  })
})

describe("parseFromAddress / splitName", () => {
  it("parses display name + angle address (lowercased)", () => {
    expect(parseFromAddress("Jane Doe <Jane@Buyer.com>")).toEqual({
      email: "jane@buyer.com",
      fullName: "Jane Doe",
    })
  })
  it("parses a bare address", () => {
    expect(parseFromAddress("bob@x.com")).toEqual({
      email: "bob@x.com",
      fullName: "",
    })
  })
  it("strips surrounding quotes from the name", () => {
    expect(parseFromAddress('"Acme Co" <sales@acme.com>').fullName).toBe(
      "Acme Co"
    )
  })
  it("handles empty input", () => {
    expect(parseFromAddress("")).toEqual({ email: "", fullName: "" })
    expect(parseFromAddress(null)).toEqual({ email: "", fullName: "" })
  })
  it("splits names", () => {
    expect(splitName("Jane Doe")).toEqual({
      first_name: "Jane",
      last_name: "Doe",
    })
    expect(splitName("Cher")).toEqual({ first_name: "Cher", last_name: null })
    expect(splitName("")).toEqual({ first_name: null, last_name: null })
  })
})

describe("buildEmailLeadKey (idempotency key)", () => {
  it("prefers message-id", () => {
    expect(buildEmailLeadKey(email())).toBe("email:<msg-1@mail.com>")
  })
  it("falls back to folder+uid when no message-id", () => {
    expect(buildEmailLeadKey(email({ message_id: null }))).toBe(
      "email:Leads:100"
    )
  })
  it("falls back to from+subject when no message-id/uid", () => {
    expect(
      buildEmailLeadKey(
        email({ message_id: "", imap_uid: "", from_address: "A@B.com" })
      )
    ).toBe("email:a@b.com:interested in bulk fabric")
  })
  it("is stable across two reads of the same email", () => {
    const e = email()
    expect(buildEmailLeadKey(e)).toBe(buildEmailLeadKey({ ...e }))
  })
})

describe("isLeadEmail", () => {
  it("matches a configured folder case-insensitively", () => {
    expect(isLeadEmail(email({ folder: "leads" }), ["Leads"])).toBe(true)
    expect(isLeadEmail(email({ folder: "LEADS" }), ["leads"])).toBe(true)
  })
  it("rejects other folders", () => {
    expect(isLeadEmail(email({ folder: "INBOX" }), ["Leads"])).toBe(false)
  })
  it("rejects ignored emails", () => {
    expect(isLeadEmail(email({ status: "ignored" }), ["Leads"])).toBe(false)
  })
  it("rejects missing folder", () => {
    expect(isLeadEmail(email({ folder: "" }))).toBe(false)
  })
})

describe("buildEmailSnippet", () => {
  it("collapses whitespace", () => {
    expect(buildEmailSnippet(email({ text_body: "a\n\n  b   c" }))).toBe("a b c")
  })
  it("truncates long bodies with an ellipsis", () => {
    const long = "x".repeat(400)
    const snip = buildEmailSnippet(email({ text_body: long }), 280)
    expect(snip.length).toBe(280)
    expect(snip.endsWith("…")).toBe(true)
  })
  it("returns empty for no body", () => {
    expect(buildEmailSnippet(email({ text_body: null }))).toBe("")
  })
})

describe("buildLeadInputFromEmail", () => {
  it("maps an email into a new lead with a stable key", () => {
    const input = buildLeadInputFromEmail(email(), NOW)
    expect(input.meta_lead_id).toBe("email:<msg-1@mail.com>")
    expect(input.email).toBe("jane@buyer.com")
    expect(input.full_name).toBe("Jane Doe")
    expect(input.first_name).toBe("Jane")
    expect(input.last_name).toBe("Doe")
    expect(input.source_platform).toBe("email")
    expect(input.status).toBe("new")
    expect(input.created_time).toEqual(daysAgo(1))
    expect(input.metadata.source).toBe("inbound_email")
    expect(input.metadata.inbound_email_id).toBe("inb_1")
    expect(input.notes).toContain("cotton")
  })
  it("uses now when received_at is missing/invalid", () => {
    const input = buildLeadInputFromEmail(email({ received_at: null }), NOW)
    expect(input.created_time).toEqual(NOW)
  })
  it("falls back to subject for notes when body empty", () => {
    const input = buildLeadInputFromEmail(
      email({ text_body: "" }),
      NOW
    )
    expect(input.notes).toBe("Interested in bulk fabric")
  })
})

describe("selectLeadEmailsToIngest", () => {
  it("selects only lead-folder emails not already ingested", () => {
    const emails = [
      email({ id: "a", message_id: "<a@m>" }),
      email({ id: "b", message_id: "<b@m>", folder: "INBOX" }), // wrong folder
      email({ id: "c", message_id: "<c@m>" }),
    ]
    const out = selectLeadEmailsToIngest(emails, {
      existingKeys: ["email:<c@m>"],
    })
    expect(out.map((e) => e.id)).toEqual(["a"])
  })
  it("de-duplicates within the batch", () => {
    const emails = [
      email({ id: "a", message_id: "<dup@m>" }),
      email({ id: "b", message_id: "<dup@m>" }),
    ]
    expect(selectLeadEmailsToIngest(emails).map((e) => e.id)).toEqual(["a"])
  })
  it("caps at maxBatch", () => {
    const emails = Array.from({ length: 5 }, (_, i) =>
      email({ id: `e${i}`, message_id: `<${i}@m>` })
    )
    expect(selectLeadEmailsToIngest(emails, { maxBatch: 2 })).toHaveLength(2)
  })
  it("returns [] for empty input", () => {
    expect(selectLeadEmailsToIngest([])).toEqual([])
    expect(selectLeadEmailsToIngest(null)).toEqual([])
  })
})

describe("selectLeadsNeedingFollowup", () => {
  const lead = (over: Record<string, any> = {}) => ({
    id: "lead_1",
    email: "jane@buyer.com",
    status: "new",
    source_platform: "email",
    created_time: daysAgo(5),
    metadata: {},
    ...over,
  })

  it("selects open, stale, un-nudged email leads", () => {
    const out = selectLeadsNeedingFollowup([lead()], {
      now: NOW,
      minAgeDays: 3,
    })
    expect(out.map((l) => l.id)).toEqual(["lead_1"])
  })
  it("skips non-email leads", () => {
    expect(
      selectLeadsNeedingFollowup([lead({ source_platform: "facebook" })], {
        now: NOW,
      })
    ).toHaveLength(0)
  })
  it("skips converted/lost leads", () => {
    expect(
      selectLeadsNeedingFollowup([lead({ status: "converted" })], { now: NOW })
    ).toHaveLength(0)
  })
  it("skips already-nudged leads (idempotent)", () => {
    expect(
      selectLeadsNeedingFollowup(
        [lead({ metadata: { followup_nudged_at: "2026-06-23T00:00:00Z" } })],
        { now: NOW }
      )
    ).toHaveLength(0)
  })
  it("skips leads younger than minAgeDays", () => {
    expect(
      selectLeadsNeedingFollowup([lead({ created_time: daysAgo(1) })], {
        now: NOW,
        minAgeDays: 3,
      })
    ).toHaveLength(0)
  })
  it("uses contacted_at over created_time as the activity clock", () => {
    expect(
      selectLeadsNeedingFollowup(
        [lead({ created_time: daysAgo(30), contacted_at: daysAgo(1) })],
        { now: NOW, minAgeDays: 3 }
      )
    ).toHaveLength(0)
  })
  it("skips soft-deleted leads", () => {
    expect(
      selectLeadsNeedingFollowup([lead({ deleted_at: daysAgo(1) })], {
        now: NOW,
      })
    ).toHaveLength(0)
  })
  it("sorts oldest-first and caps at maxBatch", () => {
    const leads = [
      lead({ id: "young", created_time: daysAgo(4) }),
      lead({ id: "old", created_time: daysAgo(20) }),
      lead({ id: "mid", created_time: daysAgo(10) }),
    ]
    const out = selectLeadsNeedingFollowup(leads, {
      now: NOW,
      minAgeDays: 3,
      maxBatch: 2,
    })
    expect(out.map((l) => l.id)).toEqual(["old", "mid"])
  })

  it("leadFollowupAlreadyNudged reflects the stamp", () => {
    expect(leadFollowupAlreadyNudged(lead())).toBe(false)
    expect(
      leadFollowupAlreadyNudged(
        lead({ metadata: { followup_nudged_at: "x" } })
      )
    ).toBe(true)
  })
})
