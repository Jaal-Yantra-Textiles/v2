import { GET } from "../route"

/**
 * The bug this guards: `query.graph` with no `pagination` returns a PAGE.
 * The route used one such call as the DENOMINATOR ("of M partners") while the
 * numerator came from a different call, so prod rendered "Europe 31/30" — a
 * coverage ratio above 1.
 *
 * Every test here is written so it FAILS against the old implementation.
 */

type GraphCall = { entity: string; pagination?: { take: number; skip: number } }

const PAGE = 200

/**
 * A fake that pages honestly: it returns at most `take` rows from `skip`,
 * exactly as the real query.graph does. A fake that always returned every row
 * regardless of pagination would let the un-paged implementation pass, which
 * is the whole failure mode being guarded.
 */
const makeQuery = (opts: {
  partners: { id: string; name: string }[]
  links: { partner_id: string }[]
  region?: Record<string, unknown> | null
}) => {
  const calls: GraphCall[] = []
  const region =
    opts.region === undefined ? { id: "reg_1", name: "Europe" } : opts.region

  const graph = jest.fn(async (args: any) => {
    calls.push({ entity: args.entity, pagination: args.pagination })
    const take = args.pagination?.take ?? PAGE
    const skip = args.pagination?.skip ?? 0
    const slice = (rows: any[]) => ({ data: rows.slice(skip, skip + take) })

    if (args.entity === "region") {
      return { data: region ? [region] : [] }
    }
    if (args.entity === "partners") {
      return slice(opts.partners)
    }
    return slice(opts.links)
  })

  return { query: { graph }, calls }
}

const run = async (query: any, regionId = "reg_1") => {
  const req: any = { scope: { resolve: () => query }, params: { id: regionId } }
  const body: any = {}
  const res: any = {
    json: (b: any) => {
      body.value = b
      return res
    },
    status: (c: number) => {
      body.status = c
      return res
    },
  }
  await GET(req, res)
  return body
}

const partners = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p_${i}`, name: `Partner ${i}` }))

describe("partner-coverage counts", () => {
  it("counts every partner past the first page, not just one page's worth", async () => {
    // 231 partners = two pages at 200. The un-paged version reports 200.
    const all = partners(231)
    const { query } = makeQuery({ partners: all, links: [] })

    const { value } = await run(query)

    expect(value.total_partners).toBe(231)
  })

  it("never reports more linked partners than exist — the 31/30 shape", async () => {
    // Every partner linked, and enough of them to cross a page boundary.
    const all = partners(231)
    const { query } = makeQuery({
      partners: all,
      links: all.map((p) => ({ partner_id: p.id })),
    })

    const { value } = await run(query)

    expect(value.linked_partners).toBeLessThanOrEqual(value.total_partners)
    expect(value.linked_partners).toBe(231)
    expect(value.total_partners).toBe(231)
  })

  it("counts links past the first page too", async () => {
    const all = partners(250)
    const { query } = makeQuery({
      partners: all,
      links: all.map((p) => ({ partner_id: p.id })),
    })

    const { value } = await run(query)

    expect(value.linked_partners).toBe(250)
    expect(value.unlinked_partners).toHaveLength(0)
  })

  it("asks for pagination explicitly on both counted entities", async () => {
    const { query, calls } = makeQuery({ partners: partners(3), links: [] })

    await run(query)

    const counted = calls.filter((c) => c.entity !== "region")
    expect(counted.length).toBeGreaterThan(0)
    for (const c of counted) {
      expect(c.pagination).toBeDefined()
      expect(typeof c.pagination!.take).toBe("number")
    }
  })

  it("reports a link naming a partner that no longer exists, and excludes it from the count", async () => {
    const all = partners(3)
    const { query } = makeQuery({
      partners: all,
      links: [...all.map((p) => ({ partner_id: p.id })), { partner_id: "p_gone" }],
    })

    const { value } = await run(query)

    // 4 distinct link rows, 3 real partners. The count must not say 4 of 3.
    expect(value.linked_partners).toBe(3)
    expect(value.total_partners).toBe(3)
    expect(value.orphaned_links).toEqual(["p_gone"])
  })

  it("still 404s an unknown region", async () => {
    const { query } = makeQuery({ partners: partners(2), links: [], region: null })

    const body = await run(query, "reg_nope")

    expect(body.status).toBe(404)
  })

  it("lists the partners that are not linked", async () => {
    const all = partners(5)
    const { query } = makeQuery({
      partners: all,
      links: [{ partner_id: "p_0" }, { partner_id: "p_3" }],
    })

    const { value } = await run(query)

    expect(value.linked_partners).toBe(2)
    expect(value.unlinked_partners.map((p: any) => p.id)).toEqual([
      "p_1",
      "p_2",
      "p_4",
    ])
  })
})
