import { BlueDartProviderAdapter } from "../adapter"
import {
  BlueDartClient,
  describeBlueDartFailure,
  describeBlueDartHttpError,
} from "../client"
import { gramsToKgString, toBlueDartTime, toMsJsonDate } from "../constants"
import type { CreateShipmentInput } from "../../provider-interface"

/**
 * Blue Dart's contract is a minefield of shapes that fail silently or with
 * unhelpful errors when got wrong (see the integration report's "gotchas").
 * These pin the ones that cost real money or produce a rejected waybill.
 */

const CFG = {
  client_id: "cid",
  client_secret: "csecret",
  login_id: "DY3585329",
  licence_key: "lickey",
  customer_code: "000001",
  origin_area: "DHM",
}

const BASE_INPUT: CreateShipmentInput = {
  reference_id: "order_1",
  payment_mode: "prepaid",
  pickup_location_name: "Dharamshala Studio",
  to: {
    name: "Delhi Recipient",
    phone: "9995554441",
    address_1: "Connaught Place",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    country: "IN",
  },
  from: {
    name: "JYT Textiles",
    phone: "9996665554",
    address_1: "Dharamshala",
    city: "Dharamshala",
    state: "HP",
    pincode: "176215",
    country: "IN",
  },
  items: [
    { name: "Handloom Scarf", sku: "SCF-1", quantity: 2, unit_price: 500, hsn: "61091000" },
  ],
  weight_grams: 500,
  sub_total: 1000,
}

/** Capture what the adapter actually sends, and reply with a success envelope. */
function buildAdapter(reply?: any) {
  const calls: Array<{ url: string; body: any; headers: any }> = []
  const fetchImpl = (async (url: string, init: any = {}) => {
    if (String(url).includes("/token/v1/login")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ JWTToken: "jwt-123" }),
        text: async () => JSON.stringify({ JWTToken: "jwt-123" }),
      }
    }
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), body, headers: init.headers })
    const payload =
      reply ??
      {
        GenerateWayBillResult: {
          AWBNo: "21089967146",
          IsError: false,
          Status: [{ StatusCode: "Valid", StatusInformation: "Waybill Generation Successful" }],
          AvailableBalance: 2698.99,
          TransactionAmount: 400.01,
          DestinationArea: "DEL",
          MPSDetails: [{ MPSNumber: "21089967146-0001" }],
        },
        CancelWaybillResult: {
          AWBNo: "21089967146",
          IsError: false,
          Status: [{ StatusCode: "Valid", StatusInformation: "cancelled successfully" }],
        },
        RegisterPickupResult: {
          IsError: false,
          TokenNumber: "4047896",
          Status: [{ StatusCode: "InsertSuccess" }],
        },
        GetServicesforPincodeResult: {
          AreaCode: "DEL",
          IsError: false,
          DomesticPriorityInbound: "Yes",
          ApexInbound: "No",
          GroundInbound: "No",
        },
      }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }) as unknown as typeof fetch

  return {
    adapter: new BlueDartProviderAdapter(new BlueDartClient({ ...CFG, fetchImpl })),
    calls,
  }
}

describe("BlueDart formatting helpers", () => {
  it("renders Microsoft-JSON dates, which is the only form Blue Dart accepts", () => {
    expect(toMsJsonDate(new Date(1786657200000))).toBe("/Date(1786657200000)/")
  })

  it("strips the colon out of a pickup time", () => {
    expect(toBlueDartTime("16:00")).toBe("1600")
    expect(toBlueDartTime("09:30")).toBe("0930")
  })

  it("converts grams to a two-decimal KG string and never sends a zero weight", () => {
    expect(gramsToKgString(500)).toBe("0.50")
    expect(gramsToKgString(1250)).toBe("1.25")
    // Blue Dart treats 0 as a missing weight and rejects the waybill outright.
    expect(Number(gramsToKgString(0))).toBeGreaterThan(0)
    expect(Number(gramsToKgString(undefined))).toBeGreaterThan(0)
  })
})

/**
 * "Blue Dart 400s with an empty body" was the belief that drove three sessions
 * of guesswork. It is not true: the gateway names the field. The body just
 * arrives pretty-printed with LEADING NEWLINES, so a logger keeping only the
 * first line renders `failed (400): ` and nothing else.
 *
 * This is the captured body from the live 2026-08-14 probe.
 */
describe("describeBlueDartHttpError", () => {
  const LIVE_400 = `
            {"status":400,
            "title":"Bad Request",
            "error-response":[{"StatusCode":"InvalidPinCode","StatusInformation":"Pincode cannot be blank "}]}`

  it("puts the carrier's own reason on one line", () => {
    const described = describeBlueDartHttpError(LIVE_400)
    expect(described).toBe("InvalidPinCode: Pincode cannot be blank")
    expect(described).not.toMatch(/\n/)
  })

  it("flattens a non-JSON body rather than losing it to a newline", () => {
    expect(describeBlueDartHttpError("\n  upstream\n  timeout\n")).toBe(
      "upstream timeout"
    )
  })

  it("says so explicitly when the body really is empty", () => {
    expect(describeBlueDartHttpError("")).toBe("(empty body)")
  })
})

describe("describeBlueDartFailure", () => {
  it("treats a 200 with IsError as a failure", () => {
    expect(describeBlueDartFailure({ IsError: true, Status: [{ StatusInformation: "no balance" }] }))
      .toBe("no balance")
  })

  it("treats a non-Valid status code as a failure even when IsError is absent", () => {
    expect(
      describeBlueDartFailure({ Status: [{ StatusCode: "Error", StatusInformation: "bad pincode" }] })
    ).toBe("bad pincode")
  })

  it("reports the bare Error string form used by the tracking endpoint", () => {
    expect(describeBlueDartFailure({ Error: "License Mismatch" })).toBe("License Mismatch")
  })

  it("passes a genuinely successful result", () => {
    expect(describeBlueDartFailure({ IsError: false, Status: [{ StatusCode: "Valid" }] })).toBeNull()
    expect(describeBlueDartFailure({ IsError: false, Status: [{ StatusCode: "InsertSuccess" }] })).toBeNull()
  })
})

describe("BlueDartProviderAdapter.createShipment", () => {
  it("sends the mandatory shapes a waybill is rejected without", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.createShipment(BASE_INPUT)

    const services = calls[0].body.Request.Services
    // Dimensions array — absent, the waybill is refused.
    expect(services.Dimensions).toHaveLength(1)
    expect(services.Dimensions[0].Count).toBe(1)
    // OTP must be the STRING "0"; the numeric 2 demands an OTPCode.
    expect(services.OTPBasedDelivery).toBe("0")
    // Commodity object is required even domestically.
    expect(services.Commodity.CommodityDetail1).toBe("61091000")
    // Profile needs BOTH Customercode and Version or auth fails obscurely.
    expect(calls[0].body.Profile).toMatchObject({
      Customercode: "000001",
      Version: "1.3",
      LoginID: "DY3585329",
    })
  })

  it("authenticates with a JWTToken header, not Authorization: Bearer", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.createShipment(BASE_INPUT)
    expect(calls[0].headers.JWTToken).toBe("jwt-123")
    expect(calls[0].headers.Authorization).toBeUndefined()
  })

  it("books no pickup at label time — a waybill and a collection slot are separate acts", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.createShipment(BASE_INPUT)
    expect(calls[0].body.Request.Services.RegisterPickup).toBe(false)
  })

  it("sends product D domestically and product H abroad, with NO sub-product code", async () => {
    const { adapter: dom, calls: domCalls } = buildAdapter()
    await dom.createShipment(BASE_INPUT)
    expect(domCalls[0].body.Request.Services.ProductCode).toBe("D")
    expect(domCalls[0].body.Request.Services.itemdtl).toEqual([])

    const { adapter: intl, calls: intlCalls } = buildAdapter()
    await intl.createShipment({
      ...BASE_INPUT,
      currency: "USD",
      to: { ...BASE_INPUT.to, country: "IL", pincode: "9100000", city: "Jerusalem" },
    })
    const svc = intlCalls[0].body.Request.Services
    expect(svc.ProductCode).toBe("H")
    // `SubProductCode` is max 1 char, A-Z — the guard drops anything else, so
    // "IPC-Expedited" (the PICKUP API's vocabulary) went out as "". "P" is the
    // 2026-08-14 candidate and passes the guard.
    // ⚠️ UNVERIFIED against the carrier — this pins what we SEND, not that Blue
    // Dart accepts it. `GetServicesforPincode` would settle it but answers
    // `UserDoesNotExists` for our LoginID.
    expect(svc.SubProductCode).toBe("P")
    expect(svc.SubProductCode).toMatch(/^[A-Z]$/)
    expect(svc.CurrencyCode).toBe("USD")
    // Per-item customs lines are mandatory on the international product.
    expect(svc.itemdtl).toHaveLength(1)
    expect(svc.itemdtl[0]).toMatchObject({ HSCode: "61091000", Itemquantity: 2, TotalValue: 1000 })
    expect(intlCalls[0].body.Request.Consignee.ConsigneeCountryCode).toBe("IL")
  })

  it("collects nothing at the door on a prepaid order", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.createShipment(BASE_INPUT)
    // Sending the order value here would ask a customer who has already paid to
    // pay again at delivery.
    expect(calls[0].body.Request.Services.CollectableAmount).toBe(0)
  })

  it("collects the COD amount on a COD order", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.createShipment({ ...BASE_INPUT, payment_mode: "cod", cod_amount: 1180 })
    expect(calls[0].body.Request.Services.CollectableAmount).toBe(1180)
  })

  it("returns the AWB, the balance and the charge as provider refs", async () => {
    const { adapter } = buildAdapter()
    const result = await adapter.createShipment(BASE_INPUT)
    expect(result).toMatchObject({ carrier: "bluedart", awb: "21089967146", tracking_number: "21089967146" })
    // The prepaid balance is the only early warning that the account is about to
    // stop shipping.
    expect(result.provider_refs?.available_balance).toBe(2698.99)
    expect(result.provider_refs?.courier_rate).toBe(400.01)
  })

  it("throws rather than returning an AWB-less success", async () => {
    const { adapter } = buildAdapter({
      GenerateWayBillResult: { IsError: false, Status: [{ StatusCode: "Valid" }] },
    })
    await expect(adapter.createShipment(BASE_INPUT)).rejects.toThrow(/no AWB/i)
  })

  it("surfaces a carrier rejection as a thrown error, not a silent success", async () => {
    const { adapter } = buildAdapter({
      GenerateWayBillResult: {
        IsError: true,
        Status: [{ StatusCode: "Error", StatusInformation: "Insufficient balance" }],
      },
    })
    await expect(adapter.createShipment(BASE_INPUT)).rejects.toThrow(/Insufficient balance/)
  })
})

describe("BlueDartProviderAdapter.cancelShipment", () => {
  it("cancels by waybill and reports success", async () => {
    const { adapter, calls } = buildAdapter()
    const res = await adapter.cancelShipment({ awb: "21089967146" })
    expect(calls[0].body.Request.AWBNo).toBe("21089967146")
    expect(res.success).toBe(true)
  })

  it("reads the waybill out of provider_refs when awb is absent", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.cancelShipment({ provider_refs: { waybill: "999" } })
    expect(calls[0].body.Request.AWBNo).toBe("999")
  })

  it("refuses without a waybill rather than posting an empty cancel", async () => {
    const { adapter } = buildAdapter()
    await expect(adapter.cancelShipment({})).rejects.toThrow(/requires a waybill/i)
  })

  it("does NOT report success when Blue Dart refuses the cancellation", async () => {
    // The dangerous failure: a false success clears our carrier refs while the
    // waybill stays live and billable — the #1225 orphan, in reverse.
    const { adapter } = buildAdapter({
      CancelWaybillResult: {
        IsError: true,
        Status: [{ StatusCode: "Error", StatusInformation: "Shipment already in transit" }],
      },
    })
    await expect(adapter.cancelShipment({ awb: "21089967146" })).rejects.toThrow(
      /already in transit/
    )
  })
})

/**
 * The collection address Blue Dart needs inline on every pickup. Verified live
 * on 2026-08-14: the same request without `pincode` is rejected
 * `InvalidPinCode` / "Pincode cannot be blank"; with it, `InsertSuccess`.
 */
const PICKUP_ORIGIN = {
  name: "JYT",
  phone: "7580067026",
  address_1: "Ram Nagar Road Sharlho Factory , Ward 11",
  address_2: "Near Nandini Villa",
  city: "Dhramshala",
  state: "Himachal Nagar",
  pincode: "176215",
  country: "in",
}

describe("BlueDartProviderAdapter.schedulePickup", () => {
  it("books against the AWB and returns the token needed to cancel it later", async () => {
    const { adapter, calls } = buildAdapter()
    const res = await adapter.schedulePickup({
      pickup_location_name: "Dharamshala Studio",
      pickup_date: "2026-08-20",
      expected_package_count: 2,
      ref: { awb: "21089967146" },
      from: PICKUP_ORIGIN,
    })
    const req = calls[0].body.request
    expect(req.AWBNo).toEqual(["21089967146"])
    expect(req.AreaCode).toBe("DHM")
    expect(req.NumberofPieces).toBe(2)
    // Empty SubProducts is rejected by the pickup API.
    expect(req.SubProducts.length).toBeGreaterThan(0)
    expect(req.ShipmentPickupDate).toMatch(/^\/Date\(\d+\)\/$/)
    expect(res.token).toBe("4047896")
  })

  it("sends pickup times as HHMM, not HH:MM", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.schedulePickup({
      pickup_location_name: "Dharamshala Studio",
      pickup_date: "2026-08-20",
      // What both UIs actually send — an <input type="time"> value.
      pickup_time: "14:00",
      ref: { awb: "21089967146" },
      from: PICKUP_ORIGIN,
    })
    const req = calls[0].body.request
    // `createShipment` normalised this and `schedulePickup` did not, so the
    // colon went straight to Blue Dart on the one call that books a courier.
    expect(req.ShipmentPickupTime).toBe("1400")
    expect(req.OfficeCloseTime).toBe("1800")
  })

  it("refuses to book a pickup before there is a waybill to collect", async () => {
    const { adapter } = buildAdapter()
    await expect(
      adapter.schedulePickup({ pickup_location_name: "X", pickup_date: "2026-08-20" })
    ).rejects.toThrow(/requires the shipment's waybill/i)
  })

  /**
   * The bug that made every pickup this app ever attempted fail. Blue Dart has
   * no pickup-location registry, so the address travels inline — but the call
   * sent `pickup_location_name` as BOTH the name and the street, with a blank
   * pincode and phone. `warehouse-AYV7GRDR` is a key into Delhivery's warehouse
   * registry (#1234), not somewhere a courier can drive.
   */
  it("sends the location's real address, not the Delhivery warehouse handle", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.schedulePickup({
      pickup_location_name: "warehouse-AYV7GRDR",
      pickup_date: "2026-08-20",
      ref: { awb: "21089967146" },
      from: PICKUP_ORIGIN,
    })
    const req = calls[0].body.request
    expect(req.CustomerPincode).toBe("176215")
    expect(req.CustomerTelephone).toBe("7580067026")
    expect(req.CustomerName).toBe("JYT")
    expect(req.ContactPersonName).toBe("JYT")
    // The street, packed to the 30-char cap — never the routing handle.
    expect(req.CustomerAddress1).not.toMatch(/warehouse-/)
    expect(req.CustomerAddress1.length).toBeLessThanOrEqual(30)
    expect(
      [req.CustomerAddress1, req.CustomerAddress2, req.CustomerAddress3].join(" ")
    ).toContain("Ram Nagar Road")
  })

  /**
   * The waybill and the pickup must agree on Dox-vs-NonDox. Order 83 went out
   * with `ProductType: 0` / `DoxNDox: "1"` and DHL Unified reported two
   * garments as `productName: "Documents"`.
   *
   * ⚠️ The enums are UNVERIFIED (unpublished; Blue Dart support not yet
   * answered). This pins that we send the PARCEL value on both calls and that
   * the two never drift apart — not that the carrier accepts them.
   */
  it("declares a parcel, not documents, and agrees with the waybill", async () => {
    const { adapter, calls } = buildAdapter()
    await adapter.schedulePickup({
      pickup_location_name: "warehouse-AYV7GRDR",
      pickup_date: "2026-08-20",
      ref: { awb: "21089967146" },
      from: PICKUP_ORIGIN,
    })
    expect(calls[0].body.request.DoxNDox).toBe("2")
  })

  it("fails locally when the location has no pincode, naming the location", async () => {
    const { adapter, calls } = buildAdapter()
    await expect(
      adapter.schedulePickup({
        pickup_location_name: "Bhujodi Warehouse",
        pickup_date: "2026-08-20",
        ref: { awb: "21089967146" },
        from: { ...PICKUP_ORIGIN, pincode: "" },
      })
    ).rejects.toThrow(/pincode.*Bhujodi Warehouse|Bhujodi Warehouse.*postal code/i)
    // Never reaches the carrier — 5 of 22 locations still have no pincode.
    expect(calls.length).toBe(0)
  })
})

describe("BlueDartProviderAdapter.checkServiceability", () => {
  it("reads the INBOUND flags — outbound describes that pincode's own senders", async () => {
    const { adapter } = buildAdapter()
    await expect(adapter.checkServiceability("110001")).resolves.toBe(true)
  })

  it("is false when no inbound product serves the destination", async () => {
    const { adapter } = buildAdapter({
      GetServicesforPincodeResult: {
        IsError: false,
        DomesticPriorityInbound: "No",
        ApexInbound: "No",
        GroundInbound: "No",
        // Outbound being available must not be mistaken for deliverability.
        DomesticPriorityOutbound: "Yes",
      },
    })
    await expect(adapter.checkServiceability("999999")).resolves.toBe(false)
  })
})

describe("BlueDartClient.trackShipment", () => {
  /**
   * Pins the tracking query, and above all pins the ABSENCE of `verno`.
   *
   * TnT folds `verno` into its licence check, so sending it returns
   * `{"Error":"License Mismatch"}` — an error that blames the credential for a
   * parameter fault. That misreading cost a session and nearly had us chasing a
   * second licence key from Blue Dart that does not exist. Re-adding `verno`
   * must fail here, loudly, rather than at 2am against a live shipment.
   */
  it("sends the documented tracking query", async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(String(url))
      if (String(url).includes("/token/v1/login")) {
        return { ok: true, status: 200, json: async () => ({ JWTToken: "jwt-123" }) }
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ShipmentData: { Shipment: [{ WaybillNo: "21089967146" }] } }),
      }
    }) as any

    const client = new BlueDartClient({ ...CFG, tracking_licence_key: "trackkey", fetchImpl })
    await client.trackShipment("21089967146")

    const url = new URL(calls[calls.length - 1])
    expect(url.pathname).toBe("/in/transportation/tracking/v1")
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      handler: "tnt",
      action: "custawbquery",
      loginid: "DY3585329",
      // A mode selector, not the number — the number rides in `numbers`.
      awb: "awb",
      numbers: "21089967146",
      // Omitting this 400s at the gateway before the tracking app sees it.
      scan: "1",
      lickey: "trackkey",
    })
    // The whole point. Any value here returns "License Mismatch".
    expect(url.searchParams.has("verno")).toBe(false)
  })

  it("uses the shipping licence key when no tracking override is set", async () => {
    // Verified live 2026-08-13: the shipping licence key authenticates against
    // TnT once `verno` is dropped. There is no second licence to obtain.
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(String(url))
      if (String(url).includes("/token/v1/login")) {
        return { ok: true, status: 200, json: async () => ({ JWTToken: "jwt-123" }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ShipmentData: { Shipment: [{}] } }) }
    }) as any

    const client = new BlueDartClient({ ...CFG, fetchImpl })
    await client.trackShipment("21089967146")
    expect(new URL(calls[calls.length - 1]).searchParams.get("lickey")).toBe("lickey")
  })

  it("surfaces a cancelled or unknown waybill as a plain failure", async () => {
    // A CANCELLED waybill drops out of TnT and answers exactly like a typo'd
    // one — observed live on AWB 21089967146 after its cancellation. The two
    // are indistinguishable at this layer, so we must not claim either.
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("/token/v1/login")) {
        return { ok: true, status: 200, json: async () => ({ JWTToken: "jwt-123" }) }
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ShipmentData: { Error: "Incorrect waybill number or No information" } }),
      }
    }) as any

    const client = new BlueDartClient({ ...CFG, fetchImpl })
    await expect(client.trackShipment("21089967146")).rejects.toThrow(
      /Incorrect waybill number or No information/
    )
  })
})
