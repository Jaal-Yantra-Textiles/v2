import {
  createCrmProxyRepositories,
  PROXY_LIST_ALL_LIMIT,
} from "../dal/crm-proxy"

/**
 * The proxy is the ONLY CRM data path in prod, and it speaks to the node purely
 * through a query string. Anything it fails to put on that query string is not
 * an error — it is a default the node picks instead, silently.
 */
describe("CrmProxyRepository query building", () => {
  const calls: string[] = []
  const original = globalThis.fetch

  beforeEach(() => {
    calls.length = 0
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url))
      return {
        ok: true,
        json: async () => ({ rows: [], count: 0, record: {} }),
      }
    }) as any
  })

  afterAll(() => {
    globalThis.fetch = original
  })

  const repos = () => createCrmProxyRepositories("https://crm.example.com", "tok")

  const lastQuery = () => new URL(calls[calls.length - 1]).searchParams

  it("sends an explicit large limit for take: null", async () => {
    // THE REGRESSION. `take: null` means "every row" in the embedded
    // repository. It used to be dropped here, and the node then defaulted to
    // its page size of 15 — so a full-collection read returned everything in
    // dev and the oldest fifteen rows in prod, with no error either way.
    await repos().crmActivityService.list({}, { take: null })
    expect(lastQuery().get("limit")).toBe(String(PROXY_LIST_ALL_LIMIT))
  })

  it("never sends limit=0, which the node reads as an empty page", async () => {
    await repos().crmPersonService.list({}, { take: null })
    expect(lastQuery().get("limit")).not.toBe("0")
  })

  it("forwards an explicit finite take unchanged", async () => {
    await repos().crmActivityService.list({}, { take: 20, skip: 40 })
    expect(lastQuery().get("limit")).toBe("20")
    expect(lastQuery().get("offset")).toBe("40")
  })

  it("omits limit entirely when the caller expresses no preference", async () => {
    // undefined must stay undefined: that is the node's own default page, and
    // forcing a value here would override every caller that wants paging.
    await repos().crmActivityService.list({})
    expect(lastQuery().has("limit")).toBe(false)
  })

  it("forwards scalar equality filters and drops operator objects", async () => {
    // The node only understands equality. An operator object silently becoming
    // `[object Object]` in the query string would filter on a literal string
    // and return nothing, which reads as "no results" rather than "unsupported".
    await repos().crmActivityService.list({
      related_type: "person",
      related_id: "crmp_1",
      occurred_at: { $gte: "2026-01-01" },
    })
    const q = lastQuery()
    expect(q.get("related_type")).toBe("person")
    expect(q.get("related_id")).toBe("crmp_1")
    expect(q.has("occurred_at")).toBe(false)
  })

  it("hits the activities segment for the activity repository", async () => {
    await repos().crmActivityService.list({})
    expect(calls[0]).toContain("/crm/activities")
  })
})
