import {
  isValidEmail,
  maskEmail,
  unsubscribeMetadata,
  resolveEmailById,
  suppressEmailEverywhere,
} from "../lib"

describe("unsubscribe — isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("jane@example.com")).toBe(true)
  })
  it("rejects garbage / non-strings", () => {
    expect(isValidEmail("nope")).toBe(false)
    expect(isValidEmail("a@b")).toBe(false)
    expect(isValidEmail(undefined)).toBe(false)
    expect(isValidEmail(123 as any)).toBe(false)
  })
})

describe("unsubscribe — maskEmail", () => {
  it("keeps the first two local chars + full domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("ja***@example.com")
  })
  it("handles a very short local part", () => {
    expect(maskEmail("a@b.com")).toBe("a***@b.com")
  })
  it("lowercases", () => {
    expect(maskEmail("JANE@Example.COM")).toBe("ja***@example.com")
  })
})

describe("unsubscribe — unsubscribeMetadata", () => {
  it("stamps unsubscribe fields while preserving existing metadata", () => {
    expect(unsubscribeMetadata({ source: "web_form", note: "keep" }, "2026-07-03T00:00:00.000Z")).toEqual({
      source: "web_form",
      note: "keep",
      unsubscribed: true,
      unsubscribed_at: "2026-07-03T00:00:00.000Z",
    })
  })
  it("is idempotent — returns null when already unsubscribed", () => {
    expect(unsubscribeMetadata({ unsubscribed: true }, "2026-07-03T00:00:00.000Z")).toBeNull()
  })
  it("handles null/undefined existing metadata", () => {
    expect(unsubscribeMetadata(null, "T")).toEqual({ unsubscribed: true, unsubscribed_at: "T" })
    expect(unsubscribeMetadata(undefined, "T")?.unsubscribed).toBe(true)
  })
})

function makeServices(overrides: any = {}) {
  return {
    personService: {
      listPeople: jest.fn(async () => []),
      updatePersonSubs: jest.fn(async () => ({})),
      updatePeople: jest.fn(async () => ({})),
      ...overrides.personService,
    },
    customerService: {
      listCustomers: jest.fn(async () => []),
      updateCustomers: jest.fn(async () => ({})),
      ...overrides.customerService,
    },
    socialsService: {
      listLeads: jest.fn(async () => []),
      updateLeads: jest.fn(async () => ({})),
      ...overrides.socialsService,
    },
  }
}

describe("unsubscribe — resolveEmailById", () => {
  it("resolves a person id to its email (lowercased)", async () => {
    const services = makeServices({
      personService: { listPeople: jest.fn(async () => [{ id: "pers_1", email: "Jane@Example.com" }]) },
    })
    expect(await resolveEmailById(services as any, "pers_1")).toBe("jane@example.com")
  })

  it("falls through person → customer → lead", async () => {
    const services = makeServices({
      customerService: { listCustomers: jest.fn(async () => [{ id: "cus_1", email: "cust@x.com" }]) },
    })
    expect(await resolveEmailById(services as any, "cus_1")).toBe("cust@x.com")
  })

  it("resolves a lead id when person/customer miss", async () => {
    const services = makeServices({
      socialsService: { listLeads: jest.fn(async () => [{ id: "lead_1", email: "lead@x.com" }]) },
    })
    expect(await resolveEmailById(services as any, "lead_1")).toBe("lead@x.com")
  })

  it("returns null when nothing matches", async () => {
    expect(await resolveEmailById(makeServices() as any, "nope")).toBeNull()
  })
})

describe("unsubscribe — suppressEmailEverywhere", () => {
  it("flips an active person: subscription inactive + metadata + counts", async () => {
    const services = makeServices({
      personService: {
        listPeople: jest.fn(async () => [
          { id: "pers_1", email: "jane@x.com", metadata: {}, subscribed: { id: "sub_1", subscription_status: "active" } },
        ]),
      },
    })
    const r = await suppressEmailEverywhere(services as any, "Jane@X.com", "T")
    expect(r.suppressed).toBe(1)
    expect(r.persons).toBe(1)
    expect(r.alreadyOff).toBe(false)
    expect(services.personService.updatePersonSubs).toHaveBeenCalledWith({
      id: "sub_1",
      subscription_status: "inactive",
      email_subscribed: "false",
    })
    expect(services.personService.updatePeople).toHaveBeenCalledWith({
      id: "pers_1",
      metadata: { unsubscribed: true, unsubscribed_at: "T" },
    })
  })

  it("suppresses the same email across customer + lead too", async () => {
    const services = makeServices({
      customerService: { listCustomers: jest.fn(async () => [{ id: "cus_1", email: "j@x.com", metadata: null }]) },
      socialsService: { listLeads: jest.fn(async () => [{ id: "lead_1", email: "j@x.com", metadata: {} }]) },
    })
    const r = await suppressEmailEverywhere(services as any, "j@x.com", "T")
    expect(r.customers).toBe(1)
    expect(r.leads).toBe(1)
    expect(r.suppressed).toBe(2)
    expect(services.customerService.updateCustomers).toHaveBeenCalledWith("cus_1", {
      metadata: { unsubscribed: true, unsubscribed_at: "T" },
    })
    expect(services.socialsService.updateLeads).toHaveBeenCalledWith({
      id: "lead_1",
      metadata: { unsubscribed: true, unsubscribed_at: "T" },
    })
  })

  it("is idempotent: already-off record flips nothing and reports alreadyOff", async () => {
    const services = makeServices({
      personService: {
        listPeople: jest.fn(async () => [
          { id: "pers_1", email: "j@x.com", metadata: { unsubscribed: true }, subscribed: { id: "sub_1", subscription_status: "inactive" } },
        ]),
      },
    })
    const r = await suppressEmailEverywhere(services as any, "j@x.com", "T")
    expect(r.suppressed).toBe(0)
    expect(r.alreadyOff).toBe(true)
    expect(services.personService.updatePersonSubs).not.toHaveBeenCalled()
    expect(services.personService.updatePeople).not.toHaveBeenCalled()
  })

  it("no match anywhere → suppressed 0, alreadyOff false", async () => {
    const r = await suppressEmailEverywhere(makeServices() as any, "ghost@x.com", "T")
    expect(r.suppressed).toBe(0)
    expect(r.alreadyOff).toBe(false)
  })
})
