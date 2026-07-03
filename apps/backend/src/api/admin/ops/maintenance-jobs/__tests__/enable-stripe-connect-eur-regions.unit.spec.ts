import {
  buildReadinessDigest,
  computeRegionLinkChanges,
  CONNECT_PROVIDER_ID,
  enableStripeConnectEurRegionsJob,
  MAX_CONNECT_REGION_SCAN,
  selectEurRegions,
  summarizeConnectEnablement,
  type RegionRow,
} from "../enable-stripe-connect-eur-regions-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * Pure logic for the `enable-stripe-connect-eur-regions` Data Plumbing job
 * (#838 Half B go-live). The container-bound run() (query.graph over
 * regions/providers/partners + remoteLink.create + resolvePartnerConnect) is
 * exercised via the maintenance-jobs API contract; here we lock the EUR-region
 * selection, link diff, summary, and readiness digest without booting the DB.
 */

describe("enable-stripe-connect-eur-regions — selectEurRegions", () => {
  it("keeps only eur-currency regions, case-insensitively", () => {
    const regions: RegionRow[] = [
      { id: "reg_1", currency_code: "eur" },
      { id: "reg_2", currency_code: "EUR" },
      { id: "reg_3", currency_code: "inr" },
      { id: "reg_4", currency_code: "usd" },
    ]
    expect(selectEurRegions(regions).map((r) => r.id)).toEqual(["reg_1", "reg_2"])
  })

  it("drops rows without an id and tolerates missing currency", () => {
    const regions = [
      { id: "", currency_code: "eur" },
      { id: "reg_ok", currency_code: "eur" },
      { id: "reg_nocur" },
    ] as RegionRow[]
    expect(selectEurRegions(regions).map((r) => r.id)).toEqual(["reg_ok"])
  })

  it("is null-safe", () => {
    expect(selectEurRegions(undefined as any)).toEqual([])
  })
})

describe("enable-stripe-connect-eur-regions — computeRegionLinkChanges", () => {
  it("flags eur regions missing the Connect provider and lists their current providers as 'before'", () => {
    const eur: RegionRow[] = [
      { id: "reg_a", currency_code: "eur", payment_providers: [{ id: "pp_system_default" }] },
      { id: "reg_b", currency_code: "eur", payment_providers: [] },
    ]
    const { toLink, alreadyLinkedIds } = computeRegionLinkChanges(eur, CONNECT_PROVIDER_ID)
    expect(alreadyLinkedIds).toEqual([])
    expect(toLink).toEqual([
      {
        entity: "region",
        id: "reg_a",
        field: "payment_providers",
        before: "pp_system_default",
        after: CONNECT_PROVIDER_ID,
      },
      {
        entity: "region",
        id: "reg_b",
        field: "payment_providers",
        before: null,
        after: CONNECT_PROVIDER_ID,
      },
    ])
  })

  it("is idempotent — a region already linked to the Connect provider yields no change", () => {
    const eur: RegionRow[] = [
      {
        id: "reg_done",
        currency_code: "eur",
        payment_providers: [{ id: "pp_system_default" }, { id: CONNECT_PROVIDER_ID }],
      },
    ]
    const { toLink, alreadyLinkedIds } = computeRegionLinkChanges(eur, CONNECT_PROVIDER_ID)
    expect(toLink).toEqual([])
    expect(alreadyLinkedIds).toEqual(["reg_done"])
  })

  it("handles the mixed case (some linked, some not)", () => {
    const eur: RegionRow[] = [
      { id: "reg_new", currency_code: "eur", payment_providers: [] },
      { id: "reg_old", currency_code: "eur", payment_providers: [{ id: CONNECT_PROVIDER_ID }] },
    ]
    const { toLink, alreadyLinkedIds } = computeRegionLinkChanges(eur, CONNECT_PROVIDER_ID)
    expect(toLink.map((c) => c.id)).toEqual(["reg_new"])
    expect(alreadyLinkedIds).toEqual(["reg_old"])
  })
})

describe("enable-stripe-connect-eur-regions — summarizeConnectEnablement", () => {
  it("reports the no-op case", () => {
    expect(
      summarizeConnectEnablement({
        dryRun: true,
        eurRegionCount: 3,
        toLinkCount: 0,
        alreadyLinkedCount: 3,
        errorCount: 0,
      })
    ).toBe("No changes — all 3 EUR region(s) already have Stripe Connect enabled")
  })

  it("uses 'Would link' on dry-run and 'Linked' on apply", () => {
    const base = { eurRegionCount: 4, toLinkCount: 2, alreadyLinkedCount: 2, errorCount: 0 }
    expect(summarizeConnectEnablement({ dryRun: true, ...base })).toContain("Would link")
    expect(summarizeConnectEnablement({ dryRun: false, ...base })).toContain("Linked")
    expect(summarizeConnectEnablement({ dryRun: false, ...base })).toContain("2/4 EUR region(s)")
  })

  it("appends an error count when present", () => {
    expect(
      summarizeConnectEnablement({
        dryRun: false,
        eurRegionCount: 2,
        toLinkCount: 1,
        alreadyLinkedCount: 0,
        errorCount: 1,
      })
    ).toContain("1 error(s)")
  })
})

describe("enable-stripe-connect-eur-regions — buildReadinessDigest", () => {
  it("flags a missing flag and unregistered provider", () => {
    const digest = buildReadinessDigest({
      flagEnabled: false,
      providerRegistered: false,
      providerEnabled: false,
      connectedPartners: [],
    })
    expect(digest).toContain("STRIPE_CONNECT_ENABLED: FALSE")
    expect(digest).toContain("NOT registered")
    expect(digest).toContain("connected partners: none yet")
  })

  it("shows a fully-ready connected partner with its resolved fee", () => {
    const digest = buildReadinessDigest({
      flagEnabled: true,
      providerRegistered: true,
      providerEnabled: true,
      connectedPartners: [
        {
          partner_id: "part_123456",
          name: "Atelier EU",
          account_last4: "AB12",
          charges_enabled: true,
          routes: true,
          fee_percent: 0.025,
        },
      ],
    })
    expect(digest).toContain("registered ✓")
    expect(digest).toContain("Atelier EU (part_123456)")
    expect(digest).toContain("routes to acct …AB12")
    expect(digest).toContain("2.50% fee")
  })

  it("distinguishes charges-not-enabled, routes-but-no-fee, and enabled-but-unroutable partners", () => {
    const digest = buildReadinessDigest({
      flagEnabled: true,
      providerRegistered: true,
      providerEnabled: true,
      connectedPartners: [
        { partner_id: "p_incomplete", account_last4: "0001", charges_enabled: false, routes: false },
        { partner_id: "p_nofee", account_last4: "0002", charges_enabled: true, routes: true, fee_percent: null },
        { partner_id: "p_stuck", account_last4: "0003", charges_enabled: true, routes: false },
      ],
    })
    expect(digest).toContain("charges NOT enabled")
    expect(digest).toContain("no fee (seed plan fee)")
    expect(digest).toContain("routing did not resolve")
  })
})

describe("enable-stripe-connect-eur-regions — registry wiring", () => {
  it("is registered and discoverable by id", () => {
    expect(getMaintenanceJob("enable-stripe-connect-eur-regions")).toBe(
      enableStripeConnectEurRegionsJob
    )
    expect(MAINTENANCE_JOBS).toContain(enableStripeConnectEurRegionsJob)
  })

  it("exposes the documented params and a sane scan cap", () => {
    expect(enableStripeConnectEurRegionsJob.params.map((p) => p.name).sort()).toEqual([
      "limit",
      "region_id",
    ])
    expect(MAX_CONNECT_REGION_SCAN).toBe(5000)
    expect(CONNECT_PROVIDER_ID).toBe("pp_stripe-connect_stripe-connect")
  })
})
