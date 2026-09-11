import {
  chunkPriceIds,
  collectHouseStoreTargets,
  collectStoreTargets,
  FX_FANOUT_JOB_BATCH_SIZE,
  MAX_FX_FANOUT_PARTNER_SCAN,
  planPriceSetFanout,
  previewFanoutCurrencies,
  replayFxFanoutJob,
  type FanoutPriceRow,
} from "../fanout-fx-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"
import { FX_FANOUT_REQUESTED } from "../../../../../workflows/fx/fanout-variant-prices"

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
    expect(names).toEqual(["partner_id", "limit", "offset", "include_house_stores"])
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

/**
 * #1996 — apply QUEUES, it does not fan out.
 *
 * The job used to run `fanoutPricesWorkflow` once per source price on the HTTP
 * request path. On 2026-09-11 that timed out five times in a row while
 * succeeding server-side every time (264 → 202 → … → 0 remaining), which is
 * indistinguishable from failure; and it was the last caller still doing the
 * thing that OOM-killed prod twice on 2026-08-19. These cases pin the new
 * contract: emit FX_FANOUT_REQUESTED in bounded batches, return immediately,
 * and never claim more than "queued".
 */
describe("replay-fx-fanout — chunkPriceIds (the batch ceiling)", () => {
  it("never emits a batch larger than the ceiling", () => {
    const ids = Array.from({ length: 264 }, (_, i) => `price_${i}`)
    const batches = chunkPriceIds(ids)
    expect(batches).toHaveLength(Math.ceil(264 / FX_FANOUT_JOB_BATCH_SIZE))
    expect(batches.every((b) => b.length <= FX_FANOUT_JOB_BATCH_SIZE)).toBe(true)
    // Nothing dropped and nothing duplicated — a ceiling that loses work is
    // worse than no ceiling.
    expect(batches.flat()).toEqual(ids)
  })

  it("returns no batches for no work, so an empty run wakes no worker", () => {
    expect(chunkPriceIds([])).toEqual([])
  })

  it("clamps a nonsense size to 1 rather than looping forever", () => {
    expect(chunkPriceIds(["a", "b"], 0)).toEqual([["a"], ["b"]])
  })
})

describe("replay-fx-fanout — apply emits instead of running the fanout", () => {
  /**
   * One partner, one store, `sourceCount` inr-priced variants. The store
   * supports inr/eur/usd, so every price plans a fanout of two currencies.
   */
  const fakeScope = (sourceCount: number, opts: { busThrows?: boolean } = {}) => {
    const emitted: any[] = []
    const graphCalls: any[] = []

    const priceSets = Array.from({ length: sourceCount }, (_, i) => ({
      product: {
        variants: [
          {
            price_set: {
              id: `pset_${i}`,
              prices: [{ id: `price_${i}`, currency_code: "inr" }],
            },
          },
        ],
      },
    }))

    const query = {
      graph: async (args: any) => {
        graphCalls.push(args)
        if (args.entity === "partners") {
          return {
            data: [
              {
                id: "partner_1",
                name: "P1",
                stores: [
                  {
                    id: "store_1",
                    name: "S1",
                    default_sales_channel_id: "sc_1",
                    supported_currencies: [
                      { currency_code: "inr" },
                      { currency_code: "eur" },
                      { currency_code: "usd" },
                    ],
                  },
                ],
              },
            ],
          }
        }
        if (args.entity === "sales_channel") {
          return { data: [{ id: "sc_1", products_link: priceSets }] }
        }
        throw new Error(`unexpected entity ${args.entity}`)
      },
    }

    const eventBus = {
      emit: async (event: any) => {
        if (opts.busThrows) throw new Error("redis unreachable")
        emitted.push(event)
      },
    }

    const container = {
      resolve: (key: string) => {
        if (key === "query") return query
        if (key === "logger") return { info: () => {}, warn: () => {} }
        if (key === "event_bus") return eventBus
        throw new Error(`unexpected resolve ${key}`)
      },
    }

    return { container, emitted, graphCalls }
  }

  it("hands every source price to the worker in bounded batches and returns", async () => {
    const { container, emitted } = fakeScope(120)

    const result = await replayFxFanoutJob.run(container, {
      dry_run: false,
      params: { partner_id: "partner_1" },
    })

    // Assert on what the bus actually received, after the call — an
    // expectation inside the mock would be swallowed by the job's catch.
    expect(emitted).toHaveLength(Math.ceil(120 / FX_FANOUT_JOB_BATCH_SIZE))
    expect(emitted.every((e) => e.name === FX_FANOUT_REQUESTED)).toBe(true)
    expect(emitted.every((e) => e.data.store_id === "store_1")).toBe(true)
    expect(
      emitted.every((e) => e.data.price_ids.length <= FX_FANOUT_JOB_BATCH_SIZE)
    ).toBe(true)
    expect(emitted.flatMap((e) => e.data.price_ids)).toHaveLength(120)

    expect(result.applied).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("says QUEUED in the summary — `applied: true` here does not mean done", async () => {
    const { container } = fakeScope(3)

    const result = await replayFxFanoutJob.run(container, {
      dry_run: false,
      params: { partner_id: "partner_1" },
    })

    // The weakened guarantee has to be in words the operator reads, not left
    // to be inferred from a boolean that still says `applied`.
    expect(result.summary).toContain("QUEUED")
    expect(result.summary).toMatch(/not yet fanned out/i)
    // …and it must name the way to confirm completion, because the preview
    // reporting 0 is the only completion signal there is.
    expect(result.summary).toMatch(/dry_run/i)
  })

  it("records an error and does NOT claim a queue when the bus is unreachable", async () => {
    const { container, emitted } = fakeScope(3, { busThrows: true })

    const result = await replayFxFanoutJob.run(container, {
      dry_run: false,
      params: { partner_id: "partner_1" },
    })

    // requestVariantPriceFanout never throws, so without its queued flag this
    // run would report a successful hand-off of everything.
    expect(emitted).toEqual([])
    expect(result.applied).toBe(false)
    expect(result.errors?.length).toBe(1)
    expect(result.errors?.[0].message).toContain("could not queue")
  })

  it("emits nothing on a dry run — the preview stays read-only", async () => {
    const { container, emitted } = fakeScope(3)

    const result = await replayFxFanoutJob.run(container, {
      dry_run: true,
      params: { partner_id: "partner_1" },
    })

    expect(emitted).toEqual([])
    expect(result.applied).toBe(false)
    // The preview is the completion signal, so it must still list the real
    // change set rather than a count.
    expect(result.changes).toHaveLength(3)
    expect(result.changes[0].after).toBe("eur, usd")
  })

  it("reports the same change set in both modes, so apply shows what it handed over", async () => {
    const preview = await replayFxFanoutJob.run(fakeScope(2).container, {
      dry_run: true,
      params: { partner_id: "partner_1" },
    })
    const applied = await replayFxFanoutJob.run(fakeScope(2).container, {
      dry_run: false,
      params: { partner_id: "partner_1" },
    })

    expect(applied.changes.map((c) => c.id)).toEqual(preview.changes.map((c) => c.id))
    expect(applied.changes.map((c) => c.after)).toEqual(preview.changes.map((c) => c.after))
    // The note is where the two differ: queued vs would-queue.
    expect(applied.changes[0].note).toMatch(/queued/i)
  })
})

describe("replay-fx-fanout — limit is a window, offset makes it a cursor", () => {
  const fakeQuery = () => {
    const calls: any[] = []
    return {
      calls,
      graph: async (args: any) => {
        calls.push(args)
        return { data: [] }
      },
    }
  }

  it("passes offset as skip with a deterministic order", async () => {
    const query = fakeQuery()
    await collectStoreTargets(query, undefined, 100, 250)

    expect(query.calls[0].pagination).toEqual({
      take: 100,
      skip: 250,
      // Without a stable sort, page 2 is not "the partners after page 1" —
      // it is an arbitrary window that can repeat or skip rows.
      order: { id: "ASC" },
    })
  })

  it("defaults to offset 0 so the existing call shape is unchanged", async () => {
    const query = fakeQuery()
    await collectStoreTargets(query, undefined, 10)
    expect(query.calls[0].pagination.skip).toBe(0)
  })

  it("warns in the param description that limit alone repeats page one", () => {
    const limit = replayFxFanoutJob.params.find((p) => p.name === "limit")
    expect(limit!.description).toMatch(/first n/i)
    const offset = replayFxFanoutJob.params.find((p) => p.name === "offset")
    expect(offset!.type).toBe("number")
    expect(offset!.required).toBe(false)
  })
})
