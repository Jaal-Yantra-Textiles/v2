import {
  buildPartnerOrderListParams,
  parseOrderParam,
} from "../list-params"

describe("parseOrderParam (#486 partner orders sort)", () => {
  it("defaults to newest-first when unset/blank", () => {
    expect(parseOrderParam(undefined)).toEqual({ created_at: "DESC" })
    expect(parseOrderParam("")).toEqual({ created_at: "DESC" })
    expect(parseOrderParam("   ")).toEqual({ created_at: "DESC" })
  })

  it("maps a leading '-' to DESC and a bare field to ASC", () => {
    expect(parseOrderParam("-created_at")).toEqual({ created_at: "DESC" })
    expect(parseOrderParam("display_id")).toEqual({ display_id: "ASC" })
    expect(parseOrderParam("-updated_at")).toEqual({ updated_at: "DESC" })
  })

  it("ignores non-string input and falls back to the default", () => {
    expect(parseOrderParam(42 as any)).toEqual({ created_at: "DESC" })
    expect(parseOrderParam({} as any)).toEqual({ created_at: "DESC" })
  })
})

describe("buildPartnerOrderListParams (#486 partner orders filters)", () => {
  it("forwards universal filters for every kind (the dropped-filter bug)", () => {
    const created = { $gte: "2026-01-01", $lte: "2026-02-01" }
    const { baseFilters } = buildPartnerOrderListParams(
      { status: "completed", q: "acme", created_at: created, updated_at: created },
      "retail"
    )
    expect(baseFilters).toEqual({
      status: "completed",
      q: "acme",
      created_at: created,
      updated_at: created,
    })
  })

  it("forwards region/sales_channel ONLY for retail", () => {
    const q = { region_id: ["reg_1"], sales_channel_id: ["sc_1"], q: "x" }
    expect(buildPartnerOrderListParams(q, "retail").baseFilters).toEqual({
      q: "x",
      region_id: ["reg_1"],
      sales_channel_id: ["sc_1"],
    })
    // Work-order kinds live in the internal channel + carry no region, so these
    // must be dropped or they'd filter every work-order out (empty table).
    expect(buildPartnerOrderListParams(q, "design").baseFilters).toEqual({ q: "x" })
    expect(buildPartnerOrderListParams(q, "inventory").baseFilters).toEqual({ q: "x" })
    expect(buildPartnerOrderListParams(q, "all").baseFilters).toEqual({ q: "x" })
  })

  it("omits absent / blank filters rather than sending empty values", () => {
    const { baseFilters } = buildPartnerOrderListParams(
      { status: "", q: "   ", created_at: undefined },
      "retail"
    )
    expect(baseFilters).toEqual({})
  })

  it("derives skip/take from offset/limit with sane defaults", () => {
    expect(buildPartnerOrderListParams({}, "retail")).toMatchObject({
      skip: 0,
      take: 20,
    })
    expect(
      buildPartnerOrderListParams({ offset: "40", limit: "50" }, "retail")
    ).toMatchObject({ skip: 40, take: 50 })
  })

  it("always returns a sort (default newest-first), honoring the UI's order param", () => {
    expect(buildPartnerOrderListParams({}, "design").order).toEqual({
      created_at: "DESC",
    })
    expect(
      buildPartnerOrderListParams({ order: "display_id" }, "retail").order
    ).toEqual({ display_id: "ASC" })
  })
})
