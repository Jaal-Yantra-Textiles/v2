import {
  backfillPartnerShippingOptionsJob,
  buildShippingSpecs,
  locationSuffix,
  DOMESTIC_MANUAL_RATES,
  INTL_MANUAL_RATES,
  MAX_SHIPPING_BACKFILL_SCAN,
} from "../backfill-partner-shipping-options-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * Pure spec-building logic for the `backfill-partner-shipping-options` Data
 * Plumbing job (#954/#649). The container-bound run() (query.graph +
 * createShippingOptionsWorkflow) runs via the maintenance-jobs API contract;
 * here we lock the per-location suffixing + tiered pricing without a DB.
 */
describe("backfill-partner-shipping-options — locationSuffix", () => {
  it("takes the last 8 alphanumerics of a location id", () => {
    expect(locationSuffix("sloc_01JABCDEF0123456789")).toBe("23456789")
  })
  it("strips non-alphanumerics", () => {
    expect(locationSuffix("sloc_01-AB")).toBe("sloc01AB")
  })
  it("differs between two locations → globally-unique names/codes", () => {
    expect(locationSuffix("sloc_AAA11111")).not.toBe(locationSuffix("sloc_BBB22222"))
  })
  it("never returns empty", () => {
    expect(locationSuffix("!!!")).toBe("loc")
  })
})

describe("backfill-partner-shipping-options — buildShippingSpecs", () => {
  it("suffixes every name AND type.code with the location suffix (collision-proof)", () => {
    const s = "ab12cd34"
    const specs = buildShippingSpecs({ suffix: s, intlCurrencies: ["usd", "eur"] })
    for (const spec of [specs.manualLocal, specs.delhivery, specs.manualIntl, specs.dhl]) {
      expect(spec.name.endsWith(`· ${s}`)).toBe(true)
      expect(spec.typeCode.endsWith(`-${s}`)).toBe(true)
    }
    // Two different locations never share a name or a type.code.
    const other = buildShippingSpecs({ suffix: "zz99zz99", intlCurrencies: ["usd"] })
    expect(specs.manualLocal.typeCode).not.toBe(other.manualLocal.typeCode)
    expect(specs.manualLocal.name).not.toBe(other.manualLocal.name)
  })

  it("domestic manual uses real INR base + a free-shipping item_total tier", () => {
    const { manualLocal } = buildShippingSpecs({ suffix: "x", intlCurrencies: [] })
    expect(manualLocal.provider_id).toBe("manual_manual")
    expect(manualLocal.price_type).toBe("flat")
    const base = manualLocal.prices.find((p) => !p.rules)
    const free = manualLocal.prices.find((p) => p.rules)
    expect(base).toEqual({ currency_code: "inr", amount: DOMESTIC_MANUAL_RATES.inr.base })
    expect(free?.amount).toBe(0)
    expect(free?.rules?.[0]).toEqual({
      attribute: "item_total",
      operator: "gte",
      value: DOMESTIC_MANUAL_RATES.inr.freeAbove,
    })
  })

  it("international manual builds a base + free tier per currency with real rates", () => {
    const { manualIntl } = buildShippingSpecs({ suffix: "x", intlCurrencies: ["usd", "eur"] })
    // 2 currencies × (base + free) = 4 price rows
    expect(manualIntl.prices).toHaveLength(4)
    const usdBase = manualIntl.prices.find((p) => p.currency_code === "usd" && !p.rules)
    expect(usdBase?.amount).toBe(INTL_MANUAL_RATES.usd.base)
    const eurFree = manualIntl.prices.find((p) => p.currency_code === "eur" && p.rules)
    expect(eurFree?.amount).toBe(0)
    expect(eurFree?.rules?.[0].value).toBe(INTL_MANUAL_RATES.eur.freeAbove)
  })

  it("falls back to the usd rate for an unlisted intl currency", () => {
    const { manualIntl } = buildShippingSpecs({ suffix: "x", intlCurrencies: ["sgd"] })
    const base = manualIntl.prices.find((p) => !p.rules)
    expect(base?.amount).toBe(INTL_MANUAL_RATES.usd.base)
  })

  it("carrier options are calculated with no flat prices", () => {
    const { delhivery, dhl } = buildShippingSpecs({ suffix: "x", intlCurrencies: ["usd"] })
    expect(delhivery.price_type).toBe("calculated")
    expect(delhivery.prices).toHaveLength(0)
    expect(dhl.price_type).toBe("calculated")
    expect(dhl.prices).toHaveLength(0)
  })
})

describe("backfill-partner-shipping-options — registry wiring", () => {
  it("is registered and resolvable by id", () => {
    expect(getMaintenanceJob("backfill-partner-shipping-options")).toBe(
      backfillPartnerShippingOptionsJob
    )
    expect(MAINTENANCE_JOBS).toContain(backfillPartnerShippingOptionsJob)
  })
  it("exposes partner_id + limit params and a sane scan cap", () => {
    expect(backfillPartnerShippingOptionsJob.params.map((p) => p.name)).toEqual([
      "partner_id",
      "limit",
    ])
    expect(MAX_SHIPPING_BACKFILL_SCAN).toBe(5000)
  })
})
