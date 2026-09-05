import {
  DTDC_DEFAULT_SERVICE_TYPE,
  DTDC_SERVICE_TYPES,
  resolveDtdcServiceType,
} from "../lib/service-types"

/**
 * `service_type_id` decides which DTDC product carries the parcel.
 *
 * The union was closed around the two the SANDBOX offers. The live account
 * offers four more, all `B2C …`, so none of them could be configured — and
 * because the value arrives from `process.env` nothing type-checked the
 * mismatch. It would have gone to DTDC verbatim and been refused there, with an
 * error about the shipment rather than the configuration.
 */
describe("resolveDtdcServiceType", () => {
  it("accepts every service type the live account offers", () => {
    expect(resolveDtdcServiceType("B2C SMART EXPRESS")).toBe("B2C SMART EXPRESS")
    expect(resolveDtdcServiceType("B2C PRIORITY")).toBe("B2C PRIORITY")
    expect(resolveDtdcServiceType("B2C PREMIUM")).toBe("B2C PREMIUM")
    expect(resolveDtdcServiceType("B2C GROUND ECONOMY")).toBe(
      "B2C GROUND ECONOMY"
    )
  })

  it("still accepts the two the sandbox offers", () => {
    expect(resolveDtdcServiceType("PRIORITY")).toBe("PRIORITY")
    expect(resolveDtdcServiceType("GROUND_EXPRESS")).toBe("GROUND_EXPRESS")
  })

  /**
   * 🔴 The live config carries `DTDC_DEFAULT_SERVICE_TYPE=GROUND EXPRESS` — a
   * SPACE — against a union that says `GROUND_EXPRESS`. It type-checked only
   * because it never met the type. This is the case that was actually broken.
   */
  it("rescues the space-vs-underscore value already in the live config", () => {
    expect(resolveDtdcServiceType("GROUND EXPRESS")).toBe("GROUND_EXPRESS")
  })

  it("does not care about case or separator style", () => {
    expect(resolveDtdcServiceType("ground-express")).toBe("GROUND_EXPRESS")
    expect(resolveDtdcServiceType("  b2c   priority  ")).toBe("B2C PRIORITY")
    expect(resolveDtdcServiceType("B2C_GROUND_ECONOMY")).toBe(
      "B2C GROUND ECONOMY"
    )
  })

  /**
   * Unlike a commodity id, the service types are a closed set per account, so
   * an unknown one is a typo — not a value DTDC added since this file was
   * written. Passing it through would be refused at booking time.
   */
  it("refuses an unknown type instead of forwarding it", () => {
    expect(resolveDtdcServiceType("B2C SUPER EXPRESS")).toBeNull()
    expect(resolveDtdcServiceType("EXPRESS")).toBeNull()
    expect(resolveDtdcServiceType("B2B PRIORITY")).toBeNull()
  })

  it("returns null for nothing, so the caller defaults deliberately", () => {
    expect(resolveDtdcServiceType(undefined)).toBeNull()
    expect(resolveDtdcServiceType(null)).toBeNull()
    expect(resolveDtdcServiceType("   ")).toBeNull()
  })

  it("keeps a safe default", () => {
    expect(DTDC_DEFAULT_SERVICE_TYPE).toBe(DTDC_SERVICE_TYPES.PRIORITY)
    expect(Object.keys(DTDC_SERVICE_TYPES)).toHaveLength(6)
  })
})
