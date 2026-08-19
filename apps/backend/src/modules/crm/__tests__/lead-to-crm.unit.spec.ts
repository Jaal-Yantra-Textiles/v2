import {
  buildCrmPersonDraft,
  CRM_EXTERNAL_SYSTEM,
  deriveLeadName,
  normalizeLeadSource,
  planLeadImport,
  summarizeLeadImport,
  type LeadSource,
} from "../lead-to-crm"

/**
 * A lead in the shape prod actually produces: `full_name` only, both split
 * fields null. Every one of the 230 live ad-leads looks like this, so it is the
 * default the tests build on rather than an edge case they bolt on at the end.
 */
const lead = (over: Partial<LeadSource> = {}): LeadSource => ({
  id: "lead_1",
  email: "raju@example.com",
  phone: "+919000000000",
  full_name: "Raju Jadhav",
  first_name: null,
  last_name: null,
  source_platform: "ig",
  campaign_name: "[07/11/2025] Promoting Cici Label's form",
  created_time: "2025-11-14T15:34:40.000Z",
  status: "new",
  external_id: null,
  external_system: null,
  ...over,
})

describe("normalizeLeadSource", () => {
  // Prod carries three spellings for two platforms; grouping by source is
  // wrong until they collapse.
  it("collapses the fb/ig/facebook spellings prod actually stores", () => {
    expect(normalizeLeadSource("fb")).toBe("facebook")
    expect(normalizeLeadSource("facebook")).toBe("facebook")
    expect(normalizeLeadSource("FB")).toBe("facebook")
    expect(normalizeLeadSource("ig")).toBe("instagram")
  })

  it("passes through unknown sources rather than discarding them", () => {
    expect(normalizeLeadSource("linkedin")).toBe("linkedin")
    expect(normalizeLeadSource(null)).toBe("unknown")
    expect(normalizeLeadSource("  ")).toBe("unknown")
  })
})

describe("deriveLeadName", () => {
  it("splits full_name when the split fields are null (the prod shape)", () => {
    expect(deriveLeadName(lead())).toEqual({
      first_name: "Raju",
      last_name: "Jadhav",
    })
  })

  it("returns null — not an empty string — for a single-token name", () => {
    // "SukhdevDhiman" is a real prod row. An empty-string surname would pass
    // the contract's `required` check silently, which is exactly the failure
    // mode this asserts against.
    const { first_name, last_name } = deriveLeadName(
      lead({ full_name: "SukhdevDhiman" })
    )
    expect(first_name).toBe("SukhdevDhiman")
    expect(last_name).toBeNull()
  })

  it("keeps every trailing token as the surname", () => {
    expect(deriveLeadName(lead({ full_name: "Suresh Kumar Matlam Ji" }))).toEqual({
      first_name: "Suresh",
      last_name: "Kumar Matlam Ji",
    })
  })

  it("prefers explicit split fields over full_name", () => {
    expect(
      deriveLeadName(lead({ first_name: "Given", last_name: "Family" }))
    ).toEqual({ first_name: "Given", last_name: "Family" })
  })

  it("falls back to the email local-part when there is no name at all", () => {
    expect(
      deriveLeadName(lead({ full_name: null, email: "jane.doe@example.com" }))
    ).toEqual({ first_name: "Jane", last_name: "Doe" })
  })
})

describe("buildCrmPersonDraft", () => {
  it("lowercases the email, since it is the uniqueness key", () => {
    const draft = buildCrmPersonDraft(lead({ email: "Raju@Example.COM" }))
    expect(draft?.email).toBe("raju@example.com")
  })

  it("carries provenance so a contact is traceable to its campaign", () => {
    const draft = buildCrmPersonDraft(lead())
    expect(draft?.metadata).toMatchObject({
      lead_id: "lead_1",
      source: "instagram",
      source_raw: "ig",
      captured_at: "2025-11-14T15:34:40.000Z",
    })
  })

  it("refuses a lead with no usable email", () => {
    // Without an email there is no key to recognise the contact on a re-run,
    // so importing it would duplicate on every subsequent pass.
    expect(buildCrmPersonDraft(lead({ email: null }))).toBeNull()
    expect(buildCrmPersonDraft(lead({ email: "not-an-email" }))).toBeNull()
  })

  it("normalizes blank optional fields to null rather than empty strings", () => {
    const draft = buildCrmPersonDraft(lead({ phone: "   ", job_title: "" }))
    expect(draft?.phone).toBeNull()
    expect(draft?.title).toBeNull()
  })
})

describe("planLeadImport", () => {
  it("creates a contact for a fresh lead", () => {
    const plan = planLeadImport([lead()])
    expect(plan.actions[0].kind).toBe("create")
    expect(plan.counts).toMatchObject({ create: 1 })
  })

  it("never re-imports a lead already stamped with its CRM id", () => {
    const plan = planLeadImport([
      lead({ external_system: CRM_EXTERNAL_SYSTEM, external_id: "crmp_abc" }),
    ])
    expect(plan.actions[0]).toMatchObject({
      kind: "skip",
      reason: "already_imported",
    })
  })

  it("still imports a lead stamped into a DIFFERENT external system", () => {
    // `external_system` is not ours to assume; a lead synced to some other CRM
    // has no bearing on whether this one holds it.
    const plan = planLeadImport([
      lead({ external_system: "hubspot", external_id: "123" }),
    ])
    expect(plan.actions[0].kind).toBe("create")
  })

  it("links rather than duplicates when the CRM already holds the email", () => {
    // The contact could have arrived via the browser extension or a manual
    // create; `crm_person.email` is unique, so a second create would be
    // rejected by the contract anyway.
    const plan = planLeadImport([lead()], { "RAJU@example.com": "crmp_existing" })
    expect(plan.actions[0]).toMatchObject({
      kind: "link",
      crm_person_id: "crmp_existing",
    })
    expect(plan.counts).toMatchObject({ link: 1 })
  })

  it("lets the first lead win when one batch holds the same email twice", () => {
    const plan = planLeadImport([
      lead({ id: "lead_1" }),
      lead({ id: "lead_2", full_name: "Raju J" }),
    ])
    expect(plan.actions.map((a) => a.kind)).toEqual(["create", "skip"])
    expect(plan.counts).toMatchObject({ create: 1, skip_duplicate_in_batch: 1 })
  })

  it("separates the two reasons a lead is unusable", () => {
    const plan = planLeadImport([
      lead({ id: "a", email: null }),
      lead({ id: "b", full_name: null, email: "@example.com" }),
    ])
    expect(plan.counts).toMatchObject({ skip_no_usable_email: 2 })
  })

  it("is convergent: replanning after an import is a complete no-op", () => {
    // The property that matters operationally — running the backfill twice
    // must not touch anything the first run created.
    const leads = [lead({ id: "a" }), lead({ id: "b", email: "b@example.com" })]
    const first = planLeadImport(leads)
    expect(first.counts.create).toBe(2)

    const afterStamp = leads.map((l) => ({
      ...l,
      external_system: CRM_EXTERNAL_SYSTEM,
      external_id: `crmp_${l.id}`,
    }))
    const second = planLeadImport(afterStamp)
    expect(second.counts).toEqual({ skip_already_imported: 2 })
  })
})

describe("summarizeLeadImport", () => {
  it("distinguishes a dry run from an applied one", () => {
    const plan = planLeadImport([lead()])
    expect(summarizeLeadImport(plan, true)).toMatch(/^Would import 1 lead/)
    expect(summarizeLeadImport(plan, false)).toMatch(/^Imported 1 lead/)
  })
})
