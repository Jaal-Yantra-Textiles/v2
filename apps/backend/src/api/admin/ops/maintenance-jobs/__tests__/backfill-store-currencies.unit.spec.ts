import {
  backfillStoreCurrenciesJob,
  computeStoreCurrencyAdditions,
  MAX_STORE_CURRENCY_SCAN,
  type SupportedCurrency,
} from "../backfill-store-currencies-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * Pure merge logic for the `backfill-store-currencies` Data Plumbing job. The
 * container-bound run() (query.graph over partners/regions + updateStoresWorkflow)
 * is exercised via the maintenance-jobs API contract; here we lock the additions
 * diff without booting the DB.
 */
describe("backfill-store-currencies — computeStoreCurrencyAdditions", () => {
  it("adds wanted currencies missing from the store, preserving existing + is_default", () => {
    const existing: SupportedCurrency[] = [
      { currency_code: "inr", is_default: true },
    ]
    const { missing, next } = computeStoreCurrencyAdditions({
      existing,
      wanted: ["inr", "eur", "usd"],
    })
    expect(missing).toEqual(["eur", "usd"])
    expect(next).toEqual([
      { currency_code: "inr", is_default: true },
      { currency_code: "eur", is_default: false },
      { currency_code: "usd", is_default: false },
    ])
  })

  it("is a no-op when the store already covers every wanted currency (idempotent)", () => {
    const existing: SupportedCurrency[] = [
      { currency_code: "inr", is_default: true },
      { currency_code: "eur" },
    ]
    const { missing, next } = computeStoreCurrencyAdditions({
      existing,
      wanted: ["inr", "eur"],
    })
    expect(missing).toEqual([])
    expect(next).toEqual([
      { currency_code: "inr", is_default: true },
      { currency_code: "eur", is_default: false },
    ])
  })

  it("is case-insensitive and de-dupes wanted", () => {
    const { missing } = computeStoreCurrencyAdditions({
      existing: [{ currency_code: "INR", is_default: true }],
      wanted: ["inr", "EUR", "eur", "usd"],
    })
    expect(missing).toEqual(["eur", "usd"])
  })
})

describe("backfill-store-currencies — registration", () => {
  it("is registered in MAINTENANCE_JOBS and resolvable by id", () => {
    expect(getMaintenanceJob("backfill-store-currencies")).toBe(
      backfillStoreCurrenciesJob
    )
    expect(MAINTENANCE_JOBS).toContain(backfillStoreCurrenciesJob)
  })

  it("exposes optional partner_id + limit params and a bounded scan cap", () => {
    expect(backfillStoreCurrenciesJob.params.map((p) => p.name)).toEqual([
      "partner_id",
      "limit",
    ])
    expect(
      backfillStoreCurrenciesJob.params.every((p) => p.required === false)
    ).toBe(true)
    expect(MAX_STORE_CURRENCY_SCAN).toBe(5000)
  })
})
