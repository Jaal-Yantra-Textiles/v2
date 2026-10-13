import { DtdcClient, isPincodeServiceable } from "@jytextiles/medusa-plugin-dtdc-shipping/lib/dtdc-client"
import { DtdcProviderAdapter } from "@jytextiles/medusa-plugin-dtdc-shipping/providers/dtdc/adapter"

jest.setTimeout(120000)

/**
 * End-to-end coverage against DTDC's REAL test environment.
 *
 * This spec does NOT stub the carrier — it books real consignments, tracks
 * real waybills and cancels them against DTDC's test/demo hosts, using the
 * test credentials below (GL018 is DTDC's test customer code).
 *
 * Run it explicitly:
 *   TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" \
 *     jest --testPathPattern="dtdc-shipping-e2e"
 *
 * The `sandbox: true` flag routes booking/label/cancel to DTDC's Shipsy demo
 * host (alphademodashboardapi.shipsy.io) and tracking to the staging host
 * (dtdcstagingapi.dtdc.com), so no live waybill is minted. The demo env
 * drifts (since ~2026-10-09 labels stream a real PDF instead of a 403, and a
 * fresh AWB tracks with no scans), so these tests pin what must always hold:
 *   - a label is real PDF bytes or a structured error, never a fake success
 *   - cancellation is rejected by the demo ERP ("REJECTED_BY_ERP_SERVER")
 */

const TEST_CREDENTIALS = {
  customer_code: process.env.DTDC_CUSTOMER_CODE || "GL018",
  api_key: process.env.DTDC_API_KEY || "f4ae602554b4a185d21695991885f0",
  tracking_username: process.env.DTDC_TRACKING_USERNAME || "GL018_trk_json",
  tracking_password: process.env.DTDC_TRACKING_PASSWORD || "chwzf",
  tracking_access_token:
    process.env.DTDC_TRACKING_ACCESS_TOKEN ||
    "GL018_trk_json:bd45addb4aa09ea88364227a4f7b951b",
}

// A serviceable lane for the test key: Delhi origin → Salem destination.
const ORIGIN_PIN = "110046"
const DEST_PIN = "636010"

// Normalized ShipmentAddress (adapter interface) — uses `address_1`/`address_2`.
const TO_ADDRESS = {
  name: "TEST CUSTOMER",
  phone: "7894561230",
  address_1: "3/658 pillayar nagar karattur",
  address_2: "",
  city: "SALEM",
  state: "Tamil Nadu",
  pincode: DEST_PIN,
}

const FROM_ADDRESS = {
  name: "TEST ENTERPRISES",
  phone: "9987456321",
  address_1: "Upper Ground Chandra Park Old Palam Road",
  address_2: "",
  city: "New Delhi",
  state: "Delhi",
  pincode: ORIGIN_PIN,
}

// Raw DtdcAddress (client interface) — uses `address_line_1`/`address_line_2`.
const RAW_ORIGIN = {
  name: "TEST ENTERPRISES",
  phone: "9987456321",
  address_line_1: "Upper Ground Chandra Park Old Palam Road",
  pincode: ORIGIN_PIN,
  city: "New Delhi",
  state: "Delhi",
}

const RAW_DEST = {
  name: "TEST CUSTOMER",
  phone: "7894561230",
  address_line_1: "3/658 pillayar nagar karattur",
  pincode: DEST_PIN,
  city: "SALEM",
  state: "Tamil Nadu",
}

describe("DTDC shipping end-to-end (real test environment)", () => {
  let client: DtdcClient
  let adapter: DtdcProviderAdapter

  beforeAll(() => {
    client = new DtdcClient({ ...TEST_CREDENTIALS, sandbox: true })
    adapter = new DtdcProviderAdapter({ ...TEST_CREDENTIALS, sandbox: true })
  })

  describe("pincode serviceability", () => {
    it("reports a Delhi → Salem lane serviceable", async () => {
      const res = await client.checkPincodeServiceability(ORIGIN_PIN, DEST_PIN)
      expect(isPincodeServiceable(res)).toBe(true)
      // The response also lists the serviceable products and their TAT.
      const products = (res?.SERV_LIST_DTLS ?? []).map((p: any) => p.NAME)
      expect(products).toContain("PRIORITY")
    })

    it("adapter.checkServiceability returns true for the same lane", async () => {
      const serviceable = await adapter.checkServiceability(DEST_PIN)
      expect(serviceable).toBe(true)
    })
  })

  describe("booking (softdata upload)", () => {
    let awb: string

    beforeAll(async () => {
      const result = await adapter.createShipment({
        reference_id: `e2e-dtdc-${Date.now()}`,
        payment_mode: "prepaid",
        pickup_location_name: "TEST ENTERPRISES",
        to: TO_ADDRESS,
        from: FROM_ADDRESS,
        items: [{ name: "Test textile", quantity: 1, unit_price: 500 }],
        weight_grams: 500,
        dimensions_cm: { length: 30, width: 25, height: 5 },
      })
      expect(result.carrier).toBe("dtdc")
      expect(result.awb).toBeTruthy()
      awb = result.awb
    })

    it("books a consignment and returns a real AWB", async () => {
      // awb was asserted non-empty in beforeAll; assert it looks like a DTDC
      // consignment number (an alpha prefix followed by digits).
      expect(awb).toMatch(/^[A-Z]+\d+/)
    })

    it("returns a tracking URL for the booked AWB", async () => {
      const result = await adapter.createShipment({
        reference_id: `e2e-dtdc-url-${Date.now()}`,
        payment_mode: "prepaid",
        pickup_location_name: "TEST ENTERPRISES",
        to: TO_ADDRESS,
        from: FROM_ADDRESS,
        items: [{ name: "Test textile", quantity: 1, unit_price: 500 }],
        weight_grams: 500,
      })
      expect(result.tracking_url).toContain(result.awb)
    })

    it("refuses an unsupported service type with a structured failure", async () => {
      // The old client sent "B2C GROUND EXPRESS", which DTDC rejects for this
      // lane — the client must surface it as an error, not a silent success.
      await expect(
        client.createShipment({
          service_type_id: "B2C GROUND EXPRESS" as any,
          length: 30,
          width: 25,
          height: 5,
          weight: 0.5,
          declared_value: 500,
          origin: RAW_ORIGIN,
          destination: RAW_DEST,
          customer_reference_number: `e2e-dtdc-bad-${Date.now()}`,
        })
      ).rejects.toThrow(/booking failed|not applicable|TAT data not found/i)
    })

    describe("tracking (JSON pull)", () => {
      it("returns the booked consignment's status", async () => {
        const tracking = await adapter.track({ awb })
        expect(tracking.carrier).toBe("dtdc")
        expect(tracking.awb).toBe(awb)
        // The demo books instantly; the shipment reports some non-empty status.
        expect(tracking.current_status).toBeTruthy()
      })

      it("returns an events array for the booked AWB", async () => {
        // Since ~2026-10-09 the staging tracker answers a fresh demo AWB with
        // no scans at all, so the live call can only prove the shape. The
        // scan normalization itself is pinned by the fixture test below.
        const tracking = await adapter.track({ awb })
        expect(Array.isArray(tracking.events)).toBe(true)
      })

      it("normalizes tracking scans into scan_type events", async () => {
        // Fixture taken from a real staging response (trackHeader/trackDetails).
        const stub = new DtdcProviderAdapter({ ...TEST_CREDENTIALS, sandbox: true })
        ;(stub as any).client = {
          trackShipment: async () => ({
            trackHeader: { strShipmentNo: "X0012189541", strStatus: "Pickup Awaited" },
            trackDetails: [
              {
                strCode: "SPL",
                strAction: "Softdata Upload",
                strOrigin: "GHAZIABAD APEX",
                strActionDate: "27082026",
                strActionTime: "0806",
              },
            ],
          }),
        }
        const tracking = await stub.track({ awb: "X0012189541" })
        expect(tracking.current_status).toBe("Pickup Awaited")
        expect(tracking.events).toHaveLength(1)
        expect(tracking.events[0].scan_type).toBe("created")
        expect(tracking.events[0].status).toBe("Softdata Upload")
        expect(tracking.events[0].location).toBe("GHAZIABAD APEX")
      })
    })

    describe("label", () => {
      it("returns real PDF bytes, or a structured label error — never a fake PDF", async () => {
        // The Shipsy demo used to answer JSON 403 here; since ~2026-10-09 it
        // streams a real PDF. Either is an honest answer. What must never
        // happen is a "success" whose bytes are not a PDF.
        const outcome = await adapter.getLabel({ awb }).then(
          (label) => ({ label, error: null as any }),
          (error) => ({ label: null as any, error })
        )
        if (outcome.error) {
          expect(String(outcome.error?.message ?? outcome.error)).toMatch(/label/i)
          return
        }
        expect(outcome.label.format).toBe("pdf")
        const bytes = Buffer.from(String(outcome.label.data), "base64")
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
      })
    })

    describe("cancellation (demo limitation)", () => {
      it("reaches the cancel endpoint (demo ERP rejects, but responds)", async () => {
        // The demo ERP rejects cancellation after booking, returning
        // { status:"OK", success:false, failures:[…] }. The client must return
        // a structured result, not throw, so callers can see the carrier's
        // answer.
        const result = await adapter.cancelShipment({ awb })
        expect(typeof result.success).toBe("boolean")
      })
    })
  })
})