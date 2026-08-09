import {
  DelhiveryApiError,
  assertDelhiveryManifestSucceeded,
} from "../client"
import { delhiveryWarehouseNameForLocation } from "../warehouse-name"

/**
 * Regression cover for the defect behind prod order #83 (#891 follow-up).
 *
 * Delhivery answers a REFUSED manifest with HTTP 200 + `success: false`, so the
 * old code stored an empty waybill and Medusa recorded a fulfillment that looked
 * completely normal. These cases pin the two halves of the fix: the refusal is
 * detected, and the pickup name both sides use is derived from the location id.
 */
describe("assertDelhiveryManifestSucceeded", () => {
  /** The exact body prod order #83's fulfillment carried. */
  const ORDER_83_BODY = {
    rmk: "ClientWarehouse matching query does not exist.",
    error: true,
    success: false,
    packages: [],
    package_count: 0,
    upload_wbn: null,
    cod_count: 0,
    cash_pickups: 0,
  }

  it("throws on the unregistered-warehouse refusal that broke order #83", () => {
    expect(() =>
      assertDelhiveryManifestSucceeded(ORDER_83_BODY, "warehouse-AYV7GRDR")
    ).toThrow(DelhiveryApiError)
  })

  it("names the pickup and the remedy, and tags the cause", () => {
    let caught: any
    try {
      assertDelhiveryManifestSucceeded(ORDER_83_BODY, "warehouse-AYV7GRDR")
    } catch (e) {
      caught = e
    }
    expect(caught.code).toBe("unregistered_pickup")
    // The operator must be able to act on this without reading the code.
    expect(caught.message).toContain("warehouse-AYV7GRDR")
    expect(caught.message).toContain("Register")
    expect(caught.message.toLowerCase()).toContain("case-sensitive")
  })

  it("accepts a real success", () => {
    expect(() =>
      assertDelhiveryManifestSucceeded(
        {
          success: true,
          upload_wbn: "1234567890",
          packages: [{ status: "Success", waybill: "1234567890", remarks: [] }],
        },
        "warehouse-A1DT5PM1"
      )
    ).not.toThrow()
  })

  it("throws on a per-package failure even when the top level says success", () => {
    expect(() =>
      assertDelhiveryManifestSucceeded(
        {
          success: true,
          packages: [
            { status: "Fail", waybill: "", remarks: ["Pincode not serviceable"] },
          ],
        },
        "warehouse-A1DT5PM1"
      )
    ).toThrow(/Pincode not serviceable/)
  })

  it("throws when nothing was actually manifested", () => {
    // `success: true` with no package and no waybill is not a shipment, and
    // silently returning it would recreate the empty-waybill fulfillment.
    expect(() =>
      assertDelhiveryManifestSucceeded({ success: true, packages: [] }, "wh")
    ).toThrow(/no package or waybill/i)
  })

  it("surfaces an unrecognised refusal rather than swallowing it", () => {
    expect(() =>
      assertDelhiveryManifestSucceeded(
        { success: false, rmk: "Wallet balance insufficient" },
        "wh"
      )
    ).toThrow(/Wallet balance insufficient/)
  })
})

describe("delhiveryWarehouseNameForLocation", () => {
  it("derives a stable name from the last 8 characters of the location id", () => {
    expect(
      delhiveryWarehouseNameForLocation("sloc_01KM55Y4FKPA3YXQCFA1DT5PM1")
    ).toBe("warehouse-A1DT5PM1")
  })

  it("matches the Shiprocket nickname scheme for the same location", () => {
    // Both carriers naming a location identically is what lets one widget and
    // one metadata convention cover both.
    const {
      pickupNicknameForLocation,
    } = require("../../pickup-locations")
    const id = "sloc_01JPAQVGYJR3CDP2Q2AYV7GRDR"
    expect(delhiveryWarehouseNameForLocation(id)).toBe(
      pickupNicknameForLocation(id)
    )
  })

  it("returns undefined without a location id, so the caller can fall back", () => {
    expect(delhiveryWarehouseNameForLocation(undefined)).toBeUndefined()
    expect(delhiveryWarehouseNameForLocation("")).toBeUndefined()
  })
})
