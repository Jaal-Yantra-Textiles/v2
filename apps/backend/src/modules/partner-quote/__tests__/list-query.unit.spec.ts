import {
  buildQuoteListQuery,
  buildQuoteSearchFilter,
  parseQuoteOrder,
  QUOTE_DEFAULT_LIMIT,
  QUOTE_MAX_LIMIT,
} from "../lib/list-query"

describe("parseQuoteOrder", () => {
  it("defaults to newest first", () => {
    // A quote list is a work queue: the one just minted is the one being
    // talked about.
    expect(parseQuoteOrder(undefined)).toEqual({ created_at: "DESC" })
    expect(parseQuoteOrder("")).toEqual({ created_at: "DESC" })
  })

  it("reads the `field:DIRECTION` shape the admin DataTable sends", () => {
    expect(parseQuoteOrder("expires_at:ASC")).toEqual({ expires_at: "ASC" })
    expect(parseQuoteOrder("expires_at:DESC")).toEqual({ expires_at: "DESC" })
    expect(parseQuoteOrder("expires_at:desc")).toEqual({ expires_at: "DESC" })
  })

  it("reads the `-field` shape", () => {
    expect(parseQuoteOrder("-quoted_landed_total")).toEqual({
      quoted_landed_total: "DESC",
    })
  })

  it("ignores a field that is not on the allowlist", () => {
    // 🔴 `order` reaches the ORM. "Whatever the client sent" is not a column
    // name, and token_hash in particular must never be a sort key — sorting by
    // a credential is a way to learn about it.
    expect(parseQuoteOrder("token_hash:ASC")).toEqual({ created_at: "DESC" })
    expect(parseQuoteOrder("; drop table:ASC")).toEqual({ created_at: "DESC" })
    expect(parseQuoteOrder("metadata:DESC")).toEqual({ created_at: "DESC" })
  })

  it("does not throw on a malformed sort — a bad param is not worth a 400", () => {
    expect(() => parseQuoteOrder(":::")).not.toThrow()
    expect(parseQuoteOrder(":::")).toEqual({ created_at: "DESC" })
  })
})

describe("buildQuoteSearchFilter", () => {
  it("is null for an absent or blank query", () => {
    expect(buildQuoteSearchFilter(undefined)).toBeNull()
    expect(buildQuoteSearchFilter("   ")).toBeNull()
  })

  it("matches the three things a human remembers about a quote", () => {
    const f = buildQuoteSearchFilter("acme") as any
    const fields = f.$or.map((c: any) => Object.keys(c)[0])
    expect(fields).toEqual([
      "email_sent_to",
      "recipient_company",
      "recipient_name",
    ])
    expect(f.$or[0].email_sent_to).toEqual({ $ilike: "%acme%" })
  })

  it("never searches the token or its hash", () => {
    // A quote must not be findable by anything resembling its credential.
    const f = buildQuoteSearchFilter("abc") as any
    const fields = f.$or.map((c: any) => Object.keys(c)[0])
    expect(fields).not.toContain("token_hash")
  })
})

describe("buildQuoteListQuery", () => {
  it("defaults to one page, newest first", () => {
    const { filters, config } = buildQuoteListQuery({})
    expect(config).toEqual({
      skip: 0,
      take: QUOTE_DEFAULT_LIMIT,
      order: { created_at: "DESC" },
      // Both list tables render "N lines · M units" off the basket. Without the
      // relation the field is absent and every row reads "0 lines · 0 units".
      relations: ["lines"],
    })
    expect(filters).toEqual({})
  })

  it("clamps limit to a ceiling — `?limit=100000` is a table scan on request", () => {
    expect(buildQuoteListQuery({ limit: 100000 }).config.take).toBe(
      QUOTE_MAX_LIMIT
    )
    expect(buildQuoteListQuery({ limit: 0 }).config.take).toBe(1)
    expect(buildQuoteListQuery({ limit: -5 }).config.take).toBe(1)
  })

  it("falls back rather than NaN-ing on junk paging params", () => {
    // These arrive as strings off a query string, and `Number("abc")` is NaN —
    // handed to `skip`/`take` that is an empty page, which reads as "this
    // partner has no quotes".
    expect(buildQuoteListQuery({ limit: "abc" }).config.take).toBe(
      QUOTE_DEFAULT_LIMIT
    )
    expect(buildQuoteListQuery({ offset: "abc" }).config.skip).toBe(0)
    expect(buildQuoteListQuery({ offset: -10 }).config.skip).toBe(0)
  })

  it("reads paging from strings, because a query string has no numbers", () => {
    const { config } = buildQuoteListQuery({ limit: "50", offset: "100" })
    expect(config.take).toBe(50)
    expect(config.skip).toBe(100)
  })

  it("applies status and partner filters", () => {
    const { filters } = buildQuoteListQuery({
      status: "superseded",
      partner_id: "part_1",
    })
    expect(filters).toMatchObject({
      status: "superseded",
      partner_id: "part_1",
    })
  })

  it("🔴 refuses to let a query string widen a pinned scope", () => {
    // The partner route pins `partner_id` to the authenticated partner. If a
    // query param could override it, any partner could list every other
    // partner's quotes — the #1397/#1433 cross-tenant shape, on a route that
    // exists precisely to be scoped.
    const { filters } = buildQuoteListQuery(
      { partner_id: "someone_else" },
      { partner_id: "part_mine" }
    )
    expect(filters.partner_id).toBe("part_mine")
  })

  it("combines a pinned scope with search and paging", () => {
    const { filters, config } = buildQuoteListQuery(
      { q: "acme", limit: "10", offset: "20", order: "expires_at:ASC" },
      { partner_id: "part_mine" }
    )
    expect(filters.partner_id).toBe("part_mine")
    expect((filters as any).$or).toHaveLength(3)
    expect(config).toEqual({
      skip: 20,
      take: 10,
      order: { expires_at: "ASC" },
      relations: ["lines"],
    })
  })
})
