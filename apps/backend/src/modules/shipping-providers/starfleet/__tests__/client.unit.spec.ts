import {
  buildPackagePayload,
  extractWaybillForOrder,
  normalizeStarfleetTracking,
  scanTypeForAction,
  shipmentTypeForReason,
  starfleetBaseUrl,
  starfleetTrackingUrl,
} from "../client"
import { CreateShipmentInput } from "../../provider-interface"

const baseInput: CreateShipmentInput = {
  reference_id: "order_123",
  payment_mode: "prepaid",
  pickup_location_name: "JaalYantraTextilesPr-in-B2C",
  to: {
    name: "Test Customer",
    phone: "+33123456789",
    email: "test@example.com",
    address_1: "1 Rue de Test",
    city: "Paris",
    state: "Paris",
    pincode: "75002",
    country: "FR",
  },
  from: {
    name: "Jaal Yantra Textiles",
    phone: "+919876543210",
    email: "ops@jaalyantra.com",
    address_1: "House no 86, Street no 8, South Ganesh Nagar",
    city: "Delhi",
    state: "Delhi",
    pincode: "110092",
    country: "IN",
  },
  items: [{ name: "Scarf", sku: "S1", quantity: 2, unit_price: 100, hsn: "62141090" }],
  weight_grams: 200,
  dimensions_cm: { length: 20, width: 15, height: 5 },
  currency: "INR",
  sub_total: 200,
}

const opts = {
  client_name: "JaalYantraTextilesPr-in-B2C",
  service_type: "EXPORTS_EXPRESS",
  billing_mode: "E" as const,
}

describe("shipmentTypeForReason", () => {
  it("maps reason codes to StarFleet shipment_type", () => {
    expect(shipmentTypeForReason(2)).toBe("gift")
    expect(shipmentTypeForReason(1)).toBe("sample")
    expect(shipmentTypeForReason(0)).toBe("sample")
    expect(shipmentTypeForReason(3)).toBe("commercial")
    expect(shipmentTypeForReason(undefined)).toBe("commercial")
  })
})

describe("buildPackagePayload", () => {
  it("populates the mandatory product IGST fields (even at 0)", () => {
    const pkg = buildPackagePayload(baseInput, opts)
    const p = pkg.products[0]
    expect(p.quantity).toBe(2)
    expect(p.product_amount).toBe(200)
    expect(p.item_commodity_value).toBe(200)
    expect(p.igst_rate).toBe(0)
    expect(p.igst_amount).toBe(0)
    expect(p.euec).toBe(false)
    expect(p.meis).toBe(false)
    expect(p.hsn_code).toBe("62141090")
  })

  it("uses the registered pickup shape (pickup_warehouse_id + zip/state/city)", () => {
    const pkg = buildPackagePayload(baseInput, {
      ...opts,
      pickup_warehouse_id: "JaalYantraTextilesPr-in-B2C",
    })
    expect(pkg.pickup_location).toEqual({
      pickup_warehouse_id: "JaalYantraTextilesPr-in-B2C",
      country: "IN",
      zip: "110092",
      state: "Delhi",
      city: "Delhi",
    })
  })

  it("falls back to an unregistered pickup (no `name` key)", () => {
    const pkg = buildPackagePayload(baseInput, opts)
    expect(pkg.pickup_location.name).toBeUndefined()
    expect(pkg.pickup_location.pickup_warehouse_id).toBeUndefined()
    expect(pkg.pickup_location).toMatchObject({
      type: "Office",
      city: "Delhi",
      state: "Delhi",
      country: "IN",
      zip: "110092",
    })
  })

  it("carries return_location + add_on_services + full consignor KYC", () => {
    const pkg = buildPackagePayload(baseInput, {
      ...opts,
      consignor_kyc: {
        document_id: "D1",
        document_type: "PAN",
        iec: "795003556",
        pan: "AAACT5410T",
        gstin: "29AAACT5410T2RJ",
        bank_ad_code: "01234567891234",
        bank_ifsc: "HDFC0000003",
        bank_ac: "5010003456792",
      },
    })
    expect(pkg.return_location).toEqual({
      address: "House no 86, Street no 8, South Ganesh Nagar",
      zip: "110092",
    })
    expect(pkg.add_on_services).toEqual({ free_domicile: false, signature_pod: false })
    expect(pkg.consignor.iec).toBe("795003556")
    expect(pkg.consignor.gstin).toBe("29AAACT5410T2RJ")
    expect(pkg.consignor.bank_ac).toBe("5010003456792")
  })

  it("flags free_domicile (DDP) from incoterm and terms from customs", () => {
    const pkg = buildPackagePayload(
      { ...baseInput, customs: { incoterm: "DDP", terms_of_invoice: "CIF" } },
      opts
    )
    expect(pkg.add_on_services.free_domicile).toBe(true)
    expect(pkg.invoice.terms).toBe("CIF")
  })

  it("stamps igst_payment_status only for commercial exports", () => {
    const sample = buildPackagePayload({ ...baseInput, customs: { reason_of_export: 1 } }, opts)
    expect(sample.invoice.igst_payment_status).toBeUndefined()
    const commercial = buildPackagePayload({ ...baseInput, customs: { reason_of_export: 3 } }, opts)
    expect(commercial.invoice.igst_payment_status).toBe("Paid")
    expect(commercial.shipment_type).toBe("commercial")
  })

  it("computes package_amount from sub_total and total_commodity_value pre-tax", () => {
    const pkg = buildPackagePayload(baseInput, opts)
    expect(pkg.package_amount).toBe(200)
    expect(pkg.total_commodity_value).toBe(200)
  })
})

describe("extractWaybillForOrder", () => {
  const batch = {
    payload: {
      status: "COMPLETED",
      data: {
        success_waybills: [
          { waybill: "DL001113245XB", order_id: "order_123" },
          { waybill: "DL999999999XB", order_id: "order_456" },
        ],
      },
    },
  }
  it("returns the waybill for a matching order_id", () => {
    expect(extractWaybillForOrder(batch, "order_123")).toBe("DL001113245XB")
  })
  it("returns empty for a missing order_id", () => {
    expect(extractWaybillForOrder(batch, "nope")).toBe("")
  })
})

describe("scanTypeForAction", () => {
  it("classifies delivery / rto / manifestation / default", () => {
    expect(scanTypeForAction("INT-PKG-DLV", "Delivered")).toBe("delivered")
    expect(scanTypeForAction("X", "return to origin")).toBe("rto")
    expect(scanTypeForAction("INT-PKG-MANF", "Package Manifestation Done")).toBe("created")
    expect(scanTypeForAction("INT-PKG-XYZ", "")).toBe("in_transit")
  })
})

describe("normalizeStarfleetTracking", () => {
  const payload = {
    payload: {
      waybills_found: [
        {
          waybill: "DL001113245XB",
          origin: "testwarehouse",
          destination: { city: "Dubai" },
          scans: [
            { city: "IN_Delhi_P", state: "Delhi", country: "IND", time: "1788343161", action: "INT-PKG-MANF", remarks: "Package Manifestation Done" },
          ],
        },
      ],
      waybills_not_found: [],
    },
  }
  it("maps scans into TrackingEvent with coarse scan_type", () => {
    const r = normalizeStarfleetTracking(payload, "DL001113245XB")
    expect(r.carrier).toBe("starfleet")
    expect(r.events).toHaveLength(1)
    expect(r.events[0].scan_type).toBe("created")
    expect(r.current_status).toBe("Package Manifestation Done")
    expect(r.destination).toBe("Dubai")
  })
})

describe("starfleetTrackingUrl", () => {
  it("builds the Delhivery track URL", () => {
    expect(starfleetTrackingUrl("DL001113245XB")).toBe(
      "https://www.delhivery.com/track/package/DL001113245XB"
    )
  })
  it("returns empty for a blank awb", () => {
    expect(starfleetTrackingUrl("")).toBe("")
  })
})
/**
 * Host selection.
 *
 * The client shipped with both hosts hardcoded to STAGING while its own tool
 * description and the API note both named the prod host. Credentials for prod
 * pointed at the sandbox do not fail loudly: they authenticate, and then
 * `pickup_warehouse_id` resolves against a registry that does not contain the
 * warehouse (gotcha #3), so it surfaces as a manifestation error instead.
 */
describe("starfleetBaseUrl", () => {
  it("defaults to staging when unset, so prod is never reached by accident", () => {
    expect(starfleetBaseUrl(undefined)).toContain("api-stage-starfleet")
    expect(starfleetBaseUrl("")).toContain("api-stage-starfleet")
  })

  it("selects the prod host only on an explicit 'prod'", () => {
    expect(starfleetBaseUrl("prod")).toBe("https://api-starfleet.delhivery.com")
    expect(starfleetBaseUrl(" PROD ")).toBe("https://api-starfleet.delhivery.com")
  })

  it("treats anything else as staging rather than guessing", () => {
    for (const v of ["staging", "stage", "production", "live", "true", "1"]) {
      expect(starfleetBaseUrl(v)).toContain("api-stage-starfleet")
    }
  })
})
