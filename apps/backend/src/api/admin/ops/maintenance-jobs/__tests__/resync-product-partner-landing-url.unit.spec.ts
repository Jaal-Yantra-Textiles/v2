import {
  buildProductLandingUrl,
  diffProductLandingUrl,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_RESYNC_SCAN,
  resyncProductLandingUrlJob,
  summarizeLandingUrlResync,
} from "../registry"

/**
 * #508 slice 5 — pure logic for the `resync-product-partner-landing-url`
 * maintenance job. The container-bound run() (query.graph pivot + live Google
 * re-sync on apply) is exercised by the API contract integration test; here we
 * lock down the drift-detection decision and the URL/summary string building
 * without booting the DB or calling Google.
 */
describe("resync-product-partner-landing-url — buildProductLandingUrl", () => {
  it("appends /products/<handle> and strips trailing slashes from the base", () => {
    expect(buildProductLandingUrl("https://acme.cicilabel.com", "tee")).toBe(
      "https://acme.cicilabel.com/products/tee"
    )
    expect(buildProductLandingUrl("https://gof.asia///", "tee")).toBe(
      "https://gof.asia/products/tee"
    )
  })

  it("returns null when the base or handle is missing", () => {
    expect(buildProductLandingUrl(null, "tee")).toBeNull()
    expect(buildProductLandingUrl("https://x.com", null)).toBeNull()
    expect(buildProductLandingUrl("", "tee")).toBeNull()
    expect(buildProductLandingUrl("https://x.com", "")).toBeNull()
  })
})

describe("resync-product-partner-landing-url — diffProductLandingUrl", () => {
  it("flags drift when the partner base differs from the global base the product was synced under", () => {
    const changes = diffProductLandingUrl(
      "prod_1",
      "tee",
      "https://acme.cicilabel.com", // partner base (#377-correct)
      "https://store.example.com" // global base (pre-#377)
    )
    expect(changes).toEqual([
      {
        entity: "product",
        id: "prod_1",
        field: "google_landing_url",
        before: "https://store.example.com/products/tee",
        after: "https://acme.cicilabel.com/products/tee",
      },
    ])
  })

  it("is a no-op when the product is NOT partner-owned (correctly on the global base)", () => {
    expect(
      diffProductLandingUrl("prod_1", "tee", null, "https://store.example.com")
    ).toEqual([])
  })

  it("is a no-op when the partner base already matches the global base", () => {
    expect(
      diffProductLandingUrl(
        "prod_1",
        "tee",
        "https://store.example.com",
        "https://store.example.com"
      )
    ).toEqual([])
  })

  it("flags drift to a partner URL even when no global base was ever configured", () => {
    const changes = diffProductLandingUrl(
      "prod_1",
      "tee",
      "https://acme.cicilabel.com",
      null
    )
    expect(changes).toEqual([
      {
        entity: "product",
        id: "prod_1",
        field: "google_landing_url",
        before: null,
        after: "https://acme.cicilabel.com/products/tee",
      },
    ])
  })

  it("is a no-op when the product has no handle (can't build/push a URL)", () => {
    expect(
      diffProductLandingUrl("prod_1", null, "https://acme.cicilabel.com", "https://store.example.com")
    ).toEqual([])
  })
})

describe("resync-product-partner-landing-url — summarizeLandingUrlResync", () => {
  it("reports no changes when nothing drifted", () => {
    expect(summarizeLandingUrlResync(true, 4, 0, 0, 0)).toBe(
      "No changes — scanned 4 synced product(s), none have a partner landing URL that drifted from their Google link"
    )
  })

  it("uses 'Would re-sync' for a dry run and notes non-partner skips", () => {
    expect(summarizeLandingUrlResync(true, 10, 3, 2, 0)).toBe(
      "Would re-sync 3 product(s) whose Google landing URL drifted from the owning partner storefront base (scanned 10); 2 not partner-owned"
    )
  })

  it("uses 'Re-synced' for an applied run and appends an error count", () => {
    expect(summarizeLandingUrlResync(false, 6, 2, 0, 1)).toBe(
      "Re-synced 2 product(s) whose Google landing URL drifted from the owning partner storefront base (scanned 6); 1 error(s)"
    )
  })
})

describe("resync-product-partner-landing-url — registry wiring", () => {
  it("is registered and discoverable by id", () => {
    expect(getMaintenanceJob("resync-product-partner-landing-url")).toBe(
      resyncProductLandingUrlJob
    )
    expect(MAINTENANCE_JOBS).toContain(resyncProductLandingUrlJob)
  })

  it("declares optional account_id + limit params and a sane cap", () => {
    expect(MAX_RESYNC_SCAN).toBeGreaterThan(0)
    const names = resyncProductLandingUrlJob.params.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(["account_id", "limit"]))
    expect(
      resyncProductLandingUrlJob.params.every((p) => p.required === false)
    ).toBe(true)
  })
})
