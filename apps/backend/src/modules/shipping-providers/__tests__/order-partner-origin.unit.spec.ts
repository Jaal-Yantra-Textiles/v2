import {
  pickCurrentGoodsLocation,
  resolveOrderShipFromLocation,
  resolveOrderPartnerId,
} from "../order-partner-origin"
import partnerOrderLink from "../../../links/partner-order"

const LINK = partnerOrderLink.entryPoint

/**
 * #1111 S4 — resolve a retail/core order's OWNING partner + ship-from location
 * FROM THE ORDER (no partner auth context). Work link first, then retail
 * sales-channel scoping; ship-from always taken from the partner's own store
 * default sales channel. Exercised with a stubbed query.graph — no DB.
 */

// A query stub keyed by entity. The partner↔order LINK entity has a generated
// entryPoint name, so callers put its rows under the "__link__" key and we map
// the real entryPoint onto it.
const makeQuery = (responses: Record<string, any[]>) => ({
  graph: jest.fn(async ({ entity }: any) => {
    if (entity === LINK) return { data: responses["__link__"] ?? [] }
    return { data: responses[entity] ?? [] }
  }),
})
const containerFor = (query: any) => ({ resolve: () => query }) as any

describe("resolveOrderPartnerId", () => {
  it("prefers the work link (source=work) over retail scoping", async () => {
    const query = makeQuery({
      __link__: [{ partner_id: "par_work" }],
      orders: [{ id: "o1", sales_channel_id: "sc_store" }],
      stores: [{ id: "st1", default_sales_channel_id: "sc_store" }],
      partners: [{ id: "par_retail", stores: [{ id: "st1" }] }],
    })
    const res = await resolveOrderPartnerId(containerFor(query), "o1")
    expect(res).toEqual({ partnerId: "par_work", source: "work" })
  })

  it("resolves retail ownership via order channel → store → partner", async () => {
    const query = makeQuery({
      __link__: [], // no work link
      orders: [{ id: "o1", sales_channel_id: "sc_store" }],
      stores: [{ id: "st1", default_sales_channel_id: "sc_store" }],
      partners: [
        { id: "par_other", stores: [{ id: "st9" }] },
        { id: "par_retail", stores: [{ id: "st1" }] },
      ],
    })
    const res = await resolveOrderPartnerId(containerFor(query), "o1")
    expect(res).toEqual({ partnerId: "par_retail", source: "retail" })
  })

  it("returns nulls when neither rule matches", async () => {
    const query = makeQuery({
      __link__: [],
      orders: [{ id: "o1", sales_channel_id: "sc_unknown" }],
      stores: [],
      partners: [],
    })
    const res = await resolveOrderPartnerId(containerFor(query), "o1")
    expect(res).toEqual({ partnerId: null, source: null })
  })

  it("degrades to nulls (never throws) on a query error", async () => {
    const query = { graph: jest.fn(async () => { throw new Error("boom") }) }
    const res = await resolveOrderPartnerId(containerFor(query), "o1")
    expect(res).toEqual({ partnerId: null, source: null })
  })
})

describe("resolveOrderShipFromLocation", () => {
  it("ships from the partner's OWN store channel location (registered nickname wins)", async () => {
    const query = makeQuery({
      __link__: [{ partner_id: "par_work" }],
      // Loaded twice: partner id lookup for resolveOrderPartnerId isn't hit here
      // (work link short-circuits), then the ship-from partner fetch:
      partners: [
        {
          id: "par_work",
          admins: [{ email: "ops@partner.test" }],
          stores: [{ default_sales_channel_id: "sc_partner" }],
        },
      ],
      sales_channels: [
        {
          stock_locations: [
            { id: "loc_plain", metadata: {}, address: { phone: "", postal_code: "" } },
            {
              id: "loc_reg",
              metadata: { shiprocket_pickup_location: "warehouse-x" },
              address: { phone: "9999", postal_code: "560001" },
            },
          ],
        },
      ],
    })
    const res = await resolveOrderShipFromLocation(containerFor(query), "o1")
    expect(res.partnerId).toBe("par_work")
    expect(res.source).toBe("work")
    expect(res.locationId).toBe("loc_reg")
    expect(res.actingEmail).toBe("ops@partner.test")
  })

  it("returns nulls when the order has no resolvable partner", async () => {
    const query = makeQuery({
      __link__: [],
      orders: [{ id: "o1", sales_channel_id: "sc_unknown" }],
      stores: [],
      partners: [],
    })
    const res = await resolveOrderShipFromLocation(containerFor(query), "o1")
    expect(res).toEqual({
      partnerId: null,
      source: null,
      locationId: null,
      actingEmail: null,
      locationSource: null,
    })
  })
})

/**
 * #891 S4 — the customer leg must ship from where the goods ACTUALLY are.
 *
 * Produced output is banked at the producing partner's location; a delivered
 * goods transfer is the record that it moved. Before S4 nothing on the customer
 * leg read that, so a jacket received at the finishing warehouse still shipped
 * from the weaver — re-creating the negative S3 exists to remove, one step on.
 */
describe("pickCurrentGoodsLocation", () => {
  it("takes the location when every run agrees", () => {
    expect(pickCurrentGoodsLocation(["sloc_b", "sloc_b"])).toEqual({
      locationId: "sloc_b",
      reason: "agreed",
    })
  })

  it("says nothing when no run has moved", () => {
    expect(pickCurrentGoodsLocation([null, undefined, ""])).toEqual({
      locationId: null,
      reason: "none",
    })
    expect(pickCurrentGoodsLocation([])).toEqual({ locationId: null, reason: "none" })
  })

  it("refuses to choose when runs landed in DIFFERENT places", () => {
    // The goods really are in two places; picking one would put a confident
    // wrong address on the label. The partner default is at least the old,
    // understood behaviour.
    expect(pickCurrentGoodsLocation(["sloc_b", "sloc_c"])).toEqual({
      locationId: null,
      reason: "split",
    })
  })

  it("ignores runs that have not moved when the rest agree", () => {
    // A run still at its origin does not make the order 'split' — only two
    // different DESTINATIONS do.
    expect(pickCurrentGoodsLocation([null, "sloc_b"])).toEqual({
      locationId: "sloc_b",
      reason: "agreed",
    })
  })
})

describe("resolveOrderShipFromLocation — the goods' current location wins", () => {
  const PARTNER_GRAPH = {
    __link__: [{ partner_id: "par_1" }],
    partners: [
      {
        id: "par_1",
        admins: [{ email: "p@example.com" }],
        stores: [{ default_sales_channel_id: "sc_partner" }],
      },
    ],
    sales_channels: [
      {
        stock_locations: [
          { id: "sloc_partner", metadata: {}, address: { phone: "1", postal_code: "2" } },
        ],
      },
    ],
  }

  // A container that resolves the query stub AND the transfers module, so the
  // goods lookup is exercised rather than swallowed by its own catch.
  const containerWith = (query: any, transfers: any, logger: any = { warn: jest.fn(), info: jest.fn() }) =>
    ({
      resolve: (key: any) => {
        if (key === "fullfilled_orders") return transfers
        if (String(key).includes("logger")) return logger
        return query
      },
    }) as any

  it("ships from the transfer destination once the goods have been received", async () => {
    const query = makeQuery({ ...PARTNER_GRAPH, production_runs: [{ id: "run_1" }] })
    const transfers = {
      listGoodsTransfers: jest.fn(async () => [{ to_location_id: "sloc_finishing" }]),
    }
    const res = await resolveOrderShipFromLocation(containerWith(query, transfers), "o1")
    expect(res.locationId).toBe("sloc_finishing")
    expect(res.locationSource).toBe("goods_transfer")
  })

  it("falls back to the partner default when no transfer has been received", async () => {
    const query = makeQuery({ ...PARTNER_GRAPH, production_runs: [{ id: "run_1" }] })
    const transfers = { listGoodsTransfers: jest.fn(async () => []) }
    const res = await resolveOrderShipFromLocation(containerWith(query, transfers), "o1")
    expect(res.locationId).toBe("sloc_partner")
    expect(res.locationSource).toBe("partner_default")
  })

  it("falls back to the partner default when the order has no production runs", async () => {
    // A plain retail order that was never produced to order.
    const query = makeQuery({ ...PARTNER_GRAPH, production_runs: [] })
    const transfers = { listGoodsTransfers: jest.fn() }
    const res = await resolveOrderShipFromLocation(containerWith(query, transfers), "o1")
    expect(res.locationId).toBe("sloc_partner")
    expect(transfers.listGoodsTransfers).not.toHaveBeenCalled()
  })

  it("falls back — and WARNS — when two runs landed in different places", async () => {
    const query = makeQuery({
      ...PARTNER_GRAPH,
      production_runs: [{ id: "run_1" }, { id: "run_2" }],
    })
    const transfers = {
      listGoodsTransfers: jest
        .fn()
        .mockResolvedValueOnce([{ to_location_id: "sloc_b" }])
        .mockResolvedValueOnce([{ to_location_id: "sloc_c" }]),
    }
    const logger = { warn: jest.fn(), info: jest.fn() }
    const res = await resolveOrderShipFromLocation(
      containerWith(query, transfers, logger),
      "o1"
    )
    expect(res.locationId).toBe("sloc_partner")
    expect(res.locationSource).toBe("partner_default")
    expect(logger.warn).toHaveBeenCalled()
    expect(String(logger.warn.mock.calls[0][0])).toMatch(/DIFFERENT locations/)
  })

  it("never lets a transfer lookup failure block a label", async () => {
    // Best-effort throughout: the old behaviour must survive a broken lookup.
    const query = makeQuery({ ...PARTNER_GRAPH, production_runs: [{ id: "run_1" }] })
    const transfers = {
      listGoodsTransfers: jest.fn(async () => {
        throw new Error("boom")
      }),
    }
    const res = await resolveOrderShipFromLocation(containerWith(query, transfers), "o1")
    expect(res.locationId).toBe("sloc_partner")
  })
})
