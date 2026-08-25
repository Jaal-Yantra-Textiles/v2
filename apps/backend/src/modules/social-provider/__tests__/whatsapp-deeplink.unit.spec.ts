import {
  generatePartnerDeeplink,
  partnerDeeplinkPath,
  verifyPartnerDeeplink,
  type PartnerDeeplinkType,
} from "../whatsapp-deeplink"

/**
 * Where a one-tap WhatsApp link actually lands (#1531 slice 3).
 *
 * ## 🔴 What this exists to stop
 *
 * The landing path used to be built in TWO places — a `switch` inside
 * `generatePartnerDeeplink` and an `if/else` chain inside
 * `/partners/wa-auth` — written months apart. Both had to agree, or the
 * partner taps the link, is authenticated, and is then dropped on the portal
 * home instead of the thing the message was about.
 *
 * Nothing errors when that happens. The link "works". The partner simply never
 * learns there was anything to see, and we read the silence as disinterest.
 * That is #1529's shape exactly: two pieces of logic that must agree, written
 * apart, disagreeing in a way whose only symptom is nothing happening.
 *
 * They are one function now, and this pins it.
 */

const ALL_TYPES: PartnerDeeplinkType[] = [
  "production_run",
  "design",
  "portal",
  "inquiry",
]

describe("partnerDeeplinkPath", () => {
  it("lands each type on its own route", () => {
    expect(partnerDeeplinkPath("production_run", "prun_01ABC")).toBe(
      "/production-runs/prun_01ABC"
    )
    expect(partnerDeeplinkPath("design", "des_01ABC")).toBe("/designs/des_01ABC")
    expect(partnerDeeplinkPath("inquiry", "dinq_01ABC")).toBe(
      "/inquiries/dinq_01ABC"
    )
  })

  /**
   * 🔴 THE DRIFT GUARD, and the reason this file exists.
   *
   * Every type in the union must resolve to a route that is not the portal
   * root — `portal` excepted, which IS the root. A type added to
   * `PartnerDeeplinkType` (and therefore offerable in a visual flow and
   * signable into a token) without a case in the path function fails here
   * rather than in a partner's browser, where it would look like a working
   * link that just went nowhere in particular.
   */
  it("🔴 every non-portal type resolves somewhere specific", () => {
    for (const type of ALL_TYPES) {
      const path = partnerDeeplinkPath(type, "res_01ABC")
      if (type === "portal") {
        expect(path).toBe("/")
      } else {
        expect(path).not.toBe("/")
        expect(path).toContain("res_01ABC")
      }
    }
  })

  it("falls back to the portal root rather than throwing", () => {
    // A token signed by an older deploy carrying a type this build has never
    // heard of. Landing somewhere useful beats a 500 in a partner's browser.
    expect(partnerDeeplinkPath("a_type_from_the_future", "x_1")).toBe("/")
    expect(partnerDeeplinkPath(null, "x_1")).toBe("/")
  })

  it("returns the root when there is no resource to open", () => {
    expect(partnerDeeplinkPath("inquiry", null)).toBe("/")
    expect(partnerDeeplinkPath("inquiry", "")).toBe("/")
    expect(partnerDeeplinkPath("portal")).toBe("/")
  })

  /**
   * The reminder dispatcher uses `"<id>:reminder:YYYY-MM-DD"` as a per-day
   * dedup key, and that synthetic id has leaked into the URL and the token
   * before now — landing the partner on a route that 404s, because the id is
   * not addressable.
   */
  it("strips the reminder dedup suffix from the id", () => {
    expect(
      partnerDeeplinkPath("production_run", "prun_01ABC:reminder:2026-08-25")
    ).toBe("/production-runs/prun_01ABC")
  })
})

describe("generatePartnerDeeplink", () => {
  it("signs a token the verifier can read back", () => {
    const { url, token } = generatePartnerDeeplink(
      { partner_id: "prtn_01", run_id: "dinq_01ABC", type: "inquiry" },
      "https://partner.jaalyantra.com"
    )

    expect(url).toBe(
      `https://partner.jaalyantra.com/inquiries/dinq_01ABC?wa_token=${token}`
    )

    const decoded = verifyPartnerDeeplink(token)
    expect(decoded).toMatchObject({
      partnerId: "prtn_01",
      runId: "dinq_01ABC",
      type: "inquiry",
    })
  })

  /**
   * 🔑 The claim on the wire is `run_id` even for an inquiry, and it must stay
   * that way. It is what every token already sitting in a partner's WhatsApp
   * thread carries; renaming it would silently break each of those links for
   * the rest of its 24-hour life, and the failure would look like partners
   * ignoring us.
   */
  it("carries an inquiry id in the existing run_id claim", () => {
    const { token } = generatePartnerDeeplink(
      { partner_id: "prtn_01", run_id: "dinq_01ABC", type: "inquiry" },
      "https://partner.jaalyantra.com"
    )
    expect(verifyPartnerDeeplink(token)?.runId).toBe("dinq_01ABC")
  })

  it("refuses a token it did not sign", () => {
    expect(verifyPartnerDeeplink("not.a.jwt")).toBeNull()
  })
})
