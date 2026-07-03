import {
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
    expect(names).toEqual(["partner_id", "limit"])
    expect(replayFxFanoutJob.params.every((p) => p.required === false)).toBe(true)
    expect(MAX_FX_FANOUT_PARTNER_SCAN).toBe(5000)
  })
})
