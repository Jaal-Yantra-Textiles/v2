import {
  resolveOrderPartnerId,
  resolveOrderShipFromLocation,
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
    expect(res).toEqual({ partnerId: null, source: null, locationId: null, actingEmail: null })
  })
})
