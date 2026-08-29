import {
  __resetCrmNodeCapabilities,
  createCrmProxyRepositories,
} from "../dal/crm-proxy"

/**
 * 🔴 The deploy-order trap (#1551).
 *
 * The CRM node ships separately from Medusa, and it reads EVERY query param it
 * does not recognise as an equality filter. A proxy that simply started sending
 * `order=-created_at` would, against an un-redeployed node, filter on a column
 * that does not exist and return an EMPTY list — strictly worse than the
 * unsorted one it was trying to fix, and with no error either way.
 *
 * So the proxy asks first. These cover both answers.
 */
describe("crm proxy — ordering is sent only when the node understands it", () => {
  const calls: string[] = []

  const mockFetch = (capabilities: string[] | undefined) =>
    jest.fn(async (url: any) => {
      const href = String(url)
      calls.push(href)
      if (href.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ok: true, writable: true, ...(capabilities ? { capabilities } : {}) }),
        } as any
      }
      return { ok: true, json: async () => ({ rows: [], count: 0 }) } as any
    })

  beforeEach(() => {
    calls.length = 0
    __resetCrmNodeCapabilities()
  })

  it("sends order to a node that advertises it", async () => {
    global.fetch = mockFetch(["order"]) as any

    const repos = createCrmProxyRepositories("http://node.test")
    await repos.crmPersonService.listAndCount({}, { take: 20, order: { created_at: "DESC" } })

    const listCall = calls.find((c) => c.includes("/crm/people"))
    expect(listCall).toContain("order=-created_at")
  })

  it("🔴 omits order against an OLD node, leaving the list unsorted rather than empty", async () => {
    global.fetch = mockFetch(undefined) as any

    const repos = createCrmProxyRepositories("http://old-node.test")
    await repos.crmPersonService.listAndCount({}, { take: 20, order: { created_at: "DESC" } })

    const listCall = calls.find((c) => c.includes("/crm/people"))
    expect(listCall).not.toContain("order=")
    expect(listCall).toContain("limit=20")
  })

  it("assumes nothing when /health cannot be reached", async () => {
    global.fetch = jest.fn(async (url: any) => {
      const href = String(url)
      calls.push(href)
      if (href.endsWith("/health")) throw new Error("connection refused")
      return { ok: true, json: async () => ({ rows: [], count: 0 }) } as any
    }) as any

    const repos = createCrmProxyRepositories("http://down-node.test")
    await repos.crmPersonService.listAndCount({}, { take: 20, order: { created_at: "DESC" } })

    expect(calls.find((c) => c.includes("/crm/people"))).not.toContain("order=")
  })

  it("does not probe at all for an unsorted list", async () => {
    global.fetch = mockFetch(["order"]) as any

    const repos = createCrmProxyRepositories("http://node.test")
    await repos.crmPersonService.listAndCount({}, { take: 20 })

    expect(calls.some((c) => c.endsWith("/health"))).toBe(false)
  })

  it("probes once per node URL, not once per call", async () => {
    global.fetch = mockFetch(["order"]) as any

    const repos = createCrmProxyRepositories("http://node.test")
    await repos.crmPersonService.listAndCount({}, { order: { created_at: "DESC" } })
    await repos.crmPersonService.listAndCount({}, { order: { created_at: "ASC" } })

    expect(calls.filter((c) => c.endsWith("/health"))).toHaveLength(1)
  })
})
