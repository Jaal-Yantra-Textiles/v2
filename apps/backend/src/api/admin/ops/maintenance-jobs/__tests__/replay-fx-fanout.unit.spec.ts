import {
  collectHouseStoreTargets,
  MAX_FX_FANOUT_PARTNER_SCAN,
  planPriceSetFanout,
  previewFanoutCurrencies,
  replayFxFanoutJob,
  type FanoutPriceRow,
} from "../fanout-fx-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * Pure preview/plan logic for the `replay-fx-fanout` Data Plumbing job. The
 * container-bound run() (query.graph pivot + fanoutPricesWorkflow) is exercised
 * via the maintenance-jobs API contract; here we lock down which currencies a
 * fanout would add without booting the DB or the workflow engine.
 */
describe("replay-fx-fanout — previewFanoutCurrencies", () => {
  it("adds every supported currency except the source and already-priced ones", () => {
    expect(
      previewFanoutCurrencies({
        sourceCurrency: "inr",
        isAutoConverted: false,
        existingCurrencies: ["inr"],
        supportedCurrencies: ["inr", "eur", "usd", "aud"],
      })
    ).toEqual(["eur", "usd", "aud"])
  })

  it("skips currencies that already exist on the price_set (idempotent)", () => {
    expect(
      previewFanoutCurrencies({
        sourceCurrency: "inr",
        isAutoConverted: false,
        existingCurrencies: ["inr", "eur"],
        supportedCurrencies: ["inr", "eur", "usd"],
      })
    ).toEqual(["usd"])
  })

  it("returns nothing for an auto-derived source (recursion guard)", () => {
    expect(
      previewFanoutCurrencies({
        sourceCurrency: "eur",
        isAutoConverted: true,
        existingCurrencies: ["inr", "eur"],
        supportedCurrencies: ["inr", "eur", "usd"],
      })
    ).toEqual([])
  })

  it("is case-insensitive and de-dupes", () => {
    expect(
      previewFanoutCurrencies({
        sourceCurrency: "INR",
        isAutoConverted: false,
        existingCurrencies: ["Inr"],
        supportedCurrencies: ["EUR", "eur", "USD"],
      })
    ).toEqual(["eur", "usd"])
  })

  it("returns nothing when the store supports only the source currency", () => {
    expect(
      previewFanoutCurrencies({
        sourceCurrency: "inr",
        isAutoConverted: false,
        existingCurrencies: ["inr"],
        supportedCurrencies: ["inr"],
      })
    ).toEqual([])
  })
})

describe("replay-fx-fanout — planPriceSetFanout", () => {
  const supportedCurrencies = ["inr", "eur", "usd"]

  it("plans fanout for the base price, skipping auto rows", () => {
    const prices: FanoutPriceRow[] = [
      { id: "price_base", currency_code: "inr", is_auto: false },
      { id: "price_eur", currency_code: "eur", is_auto: true },
    ]
    expect(
      planPriceSetFanout({ priceSetId: "pset_1", prices, supportedCurrencies })
    ).toEqual([{ source_price_id: "price_base", source_currency: "inr", add: ["usd"] }])
  })

  it("returns an empty plan when a price_set is fully priced", () => {
    const prices: FanoutPriceRow[] = [
      { id: "price_base", currency_code: "inr", is_auto: false },
      { id: "price_eur", currency_code: "eur", is_auto: true },
      { id: "price_usd", currency_code: "usd", is_auto: true },
    ]
    expect(
      planPriceSetFanout({ priceSetId: "pset_1", prices, supportedCurrencies })
    ).toEqual([])
  })

  it("returns an empty plan when the only row is auto-derived", () => {
    const prices: FanoutPriceRow[] = [
      { id: "price_eur", currency_code: "eur", is_auto: true },
    ]
    expect(
      planPriceSetFanout({ priceSetId: "pset_1", prices, supportedCurrencies })
    ).toEqual([])
  })
})

describe("replay-fx-fanout — registration", () => {
  it("is registered in MAINTENANCE_JOBS and resolvable by id", () => {
    expect(getMaintenanceJob("replay-fx-fanout")).toBe(replayFxFanoutJob)
    expect(MAINTENANCE_JOBS).toContain(replayFxFanoutJob)
  })

  it("exposes optional partner_id + limit params and a bounded scan cap", () => {
    const names = replayFxFanoutJob.params.map((p) => p.name)
    // include_house_stores joined in when the job was extended past partner
    // stores; the list is asserted exactly so a new param is a deliberate edit.
    expect(names).toEqual(["partner_id", "limit", "include_house_stores"])
    expect(replayFxFanoutJob.params.every((p) => p.required === false)).toBe(true)
    expect(MAX_FX_FANOUT_PARTNER_SCAN).toBe(5000)
  })
})

/**
 * House stores — the ones no partner owns.
 *
 * This job used to walk `partners → stores` only, so a store with no partner
 * was unreachable and every price on its channel was invisible to the replay.
 * That is where admin-side custom-design products live, and the route that
 * writes their prices (core's `/admin/products/:id/variants/batch`) does not
 * fan out inline either — so those prices were stuck in one currency with no
 * repair path. These cases pin the enumeration that closes it.
 */
describe("replay-fx-fanout — collectHouseStoreTargets", () => {
  /** A `query.graph` stub that answers by entity. */
  const fakeQuery = (stores: any[], partners: any[]) => ({
    graph: async ({ entity }: { entity: string }) => {
      if (entity === "stores") return { data: stores }
      if (entity === "partners") return { data: partners }
      throw new Error(`unexpected entity ${entity}`)
    },
  })

  const currencies = (...codes: string[]) =>
    codes.map((currency_code) => ({ currency_code }))

  it("returns the store no partner owns, and excludes partner-owned ones", async () => {
    const query = fakeQuery(
      [
        {
          id: "store_house",
          name: "JYT",
          default_sales_channel_id: "sc_house",
          supported_currencies: currencies("inr", "eur", "usd"),
        },
        {
          id: "store_partner",
          name: "Partner Shop",
          default_sales_channel_id: "sc_partner",
          supported_currencies: currencies("inr", "eur"),
        },
      ],
      [{ id: "partner_1", stores: [{ id: "store_partner" }] }]
    )

    const { targets, skippedStores } = await collectHouseStoreTargets(query)

    expect(targets.map((t) => t.storeId)).toEqual(["store_house"])
    expect(skippedStores).toBe(0)
    const [house] = targets
    // partnerId null is what marks it as a house store in the result rows.
    expect(house.partnerId).toBeNull()
    expect(house.channelId).toBe("sc_house")
    expect(house.supportedCurrencies).toEqual(["inr", "eur", "usd"])
  })

  it("skips a house store with no default sales channel — nothing is priced through it", async () => {
    const query = fakeQuery(
      [
        {
          id: "store_house",
          name: "JYT",
          default_sales_channel_id: null,
          supported_currencies: currencies("inr", "eur"),
        },
      ],
      []
    )

    const { targets, skippedStores } = await collectHouseStoreTargets(query)

    expect(targets).toEqual([])
    expect(skippedStores).toBe(1)
  })

  it("skips a house store with a single currency — there is nothing to convert to", async () => {
    const query = fakeQuery(
      [
        {
          id: "store_house",
          name: "JYT",
          default_sales_channel_id: "sc_house",
          supported_currencies: currencies("inr"),
        },
      ],
      []
    )

    const { targets, skippedStores } = await collectHouseStoreTargets(query)

    expect(targets).toEqual([])
    expect(skippedStores).toBe(1)
  })

  it("treats a store reachable from ANY partner as owned, not house", async () => {
    const query = fakeQuery(
      [
        {
          id: "store_shared",
          name: "Shared",
          default_sales_channel_id: "sc_shared",
          supported_currencies: currencies("inr", "eur"),
        },
      ],
      [
        { id: "partner_1", stores: [] },
        { id: "partner_2", stores: [{ id: "store_shared" }] },
      ]
    )

    const { targets } = await collectHouseStoreTargets(query)

    expect(targets).toEqual([])
  })

  it("tolerates partners with no stores array and stores with no currencies", async () => {
    const query = fakeQuery(
      [
        { id: "store_a", default_sales_channel_id: "sc_a" },
        {
          id: "store_b",
          default_sales_channel_id: "sc_b",
          supported_currencies: currencies("inr", "usd"),
        },
      ],
      [{ id: "partner_1" }]
    )

    const { targets, skippedStores } = await collectHouseStoreTargets(query)

    expect(targets.map((t) => t.storeId)).toEqual(["store_b"])
    expect(skippedStores).toBe(1)
  })
})

describe("replay-fx-fanout — include_house_stores param", () => {
  it("is declared, optional, and boolean so an operator can turn the expansion off", () => {
    const param = (replayFxFanoutJob.params ?? []).find(
      (p: any) => p.name === "include_house_stores"
    )
    expect(param).toBeDefined()
    expect(param!.type).toBe("boolean")
    expect(param!.required).toBe(false)
  })

  it("says in its description that house stores are covered", () => {
    expect(replayFxFanoutJob.description.toLowerCase()).toContain("house")
  })
})
