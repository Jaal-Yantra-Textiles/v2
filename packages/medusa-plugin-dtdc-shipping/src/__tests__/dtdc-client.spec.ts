import {
  DtdcClient,
  DtdcApiError,
  dtdcScanType,
  normalizeDtdcWebhook,
  assertDtdcBookingSucceeded,
  isPincodeServiceable,
} from "../lib/dtdc-client"

const opts = {
  customer_code: "GL018",
  api_key: "f4ae602554b4a185d21695991885f0",
  tracking_username: "GL018_trk_json",
  tracking_password: "chwzf",
}

type FetchResult = {
  status: number
  ok: boolean
  headers: { get: (k: string) => string | null }
  text: () => Promise<string>
  json: () => Promise<any>
  arrayBuffer: () => Promise<ArrayBuffer>
}

const mockResponse = (
  body: any,
  opts: { status?: number; headers?: Record<string, string> } = {}
): FetchResult => {
  const status = opts.status ?? 200
  const headers = opts.headers ?? {}
  const text = () =>
    Promise.resolve(typeof body === "string" ? body : JSON.stringify(body))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
    text,
    json: async () => JSON.parse(await text()),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const mockFetch = (result: FetchResult) =>
  jest.fn().mockResolvedValue(result) as any

describe("DtdcClient", () => {
  let client: DtdcClient

  beforeEach(() => {
    client = new DtdcClient({ ...opts, fetchImpl: jest.fn() as any })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe("dtdcScanType", () => {
    it("maps delivered codes", () => {
      expect(dtdcScanType("DLD", "")).toBe("delivered")
      expect(dtdcScanType("", "Delivered")).toBe("delivered")
    })

    it("maps return codes", () => {
      expect(dtdcScanType("RTO", "")).toBe("rto")
      expect(dtdcScanType("", "Returned to origin")).toBe("rto")
    })

    it("maps booking/pickup/transit text", () => {
      expect(dtdcScanType("SPL", "Softdata Upload")).toBe("created")
      expect(dtdcScanType("", "Booked")).toBe("created")
      expect(dtdcScanType("PCAW", "Pickup Awaited")).toBe("picked_up")
      expect(dtdcScanType("", "Out for delivery")).toBe("shipped")
      expect(dtdcScanType("", "In transit")).toBe("in_transit")
    })

    it("falls back to in_transit for unknown", () => {
      expect(dtdcScanType("XX", "something")).toBe("in_transit")
    })
  })

  describe("isPincodeServiceable", () => {
    it("is serviceable when ZIPCODE_RESP.SERV_COD is Y", () => {
      expect(
        isPincodeServiceable({ ZIPCODE_RESP: [{ SERV_COD: "Y" }] })
      ).toBe(true)
    })

    it("is serviceable when SERV_LIST.b2C_SERVICEABLE is YES", () => {
      expect(
        isPincodeServiceable({ SERV_LIST: [{ b2C_SERVICEABLE: "YES" }] })
      ).toBe(true)
    })

    it("is not serviceable when neither flag is set", () => {
      expect(isPincodeServiceable({})).toBe(false)
      expect(
        isPincodeServiceable({
          ZIPCODE_RESP: [{ SERV_COD: "N" }],
          SERV_LIST: [{ b2C_SERVICEABLE: "NO" }],
        })
      ).toBe(false)
    })
  })

  describe("normalizeDtdcWebhook", () => {
    it("extracts awb, status and events from a trackHeader push", () => {
      const payload = {
        statusCode: 200,
        status: "SUCCESS",
        trackHeader: {
          strShipmentNo: "X0012189541",
          strStatus: "Pickup Awaited",
          strCNProduct: "PRIORITY",
          strExpectedDeliveryDate: "2026-08-29",
        },
        trackDetails: [
          {
            strCode: "SPL",
            strAction: "Softdata Upload",
            strOrigin: "GHAZIABAD APEX",
            strActionDate: "27082026",
            strActionTime: "0806",
          },
        ],
      }
      const result = normalizeDtdcWebhook(payload)
      expect(result.carrier).toBe("dtdc")
      expect(result.awb).toBe("X0012189541")
      expect(result.current_status).toBe("Pickup Awaited")
      expect(result.current_status_code).toBe("PRIORITY")
      expect(result.events).toHaveLength(1)
      expect(result.events[0].scan_type).toBe("created")
      expect(result.events[0].location).toBe("GHAZIABAD APEX")
    })

    it("returns empty awb for an unrecognised payload", () => {
      expect(normalizeDtdcWebhook({}).awb).toBe("")
    })
  })

  describe("assertDtdcBookingSucceeded", () => {
    it("passes a successful body", () => {
      expect(() =>
        assertDtdcBookingSucceeded({
          status: "OK",
          data: [{ success: true, reference_number: "X0012189541" }],
        })
      ).not.toThrow()
    })

    it("throws when a per-consignment success is false", () => {
      expect(() =>
        assertDtdcBookingSucceeded({
          status: "OK",
          data: [
            { success: false, reason: "WRONG_INPUT", message: "bad pincode" },
          ],
        })
      ).toThrow(DtdcApiError)
    })

    it("throws when no consignment data is returned", () => {
      expect(() =>
        assertDtdcBookingSucceeded({ status: "OK", data: [] })
      ).toThrow(DtdcApiError)
    })
  })

  describe("createShipment", () => {
    it("sends api-key header and returns the awb", async () => {
      const fetchMock = mockFetch(
        mockResponse({
          status: "OK",
          data: [{ success: true, reference_number: "X0012189541" }],
        })
      )
      client = new DtdcClient({ ...opts, fetchImpl: fetchMock })

      const result = await client.createShipment({
        length: 30,
        width: 25,
        height: 5,
        weight: 0.5,
        declared_value: 500,
        origin: {
          name: "Warehouse",
          phone: "9987456321",
          address_line_1: "Test address",
          pincode: "110046",
          city: "New Delhi",
          state: "Delhi",
        },
        destination: {
          name: "Customer",
          phone: "7894561230",
          address_line_1: "Dest address",
          pincode: "636010",
          city: "SALEM",
          state: "Tamil Nadu",
        },
        customer_reference_number: "ORDER-1",
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/customer/integration/consignment/softdata")
      expect(init.headers["api-key"]).toBe(opts.api_key)

      const body = JSON.parse(init.body)
      expect(body.consignments[0].customer_code).toBe("GL018")
      expect(body.consignments[0].service_type_id).toBe("PRIORITY")
      expect(body.consignments[0].weight).toBe("0.5")
      expect(body.consignments[0].weight_unit).toBe("kg")

      expect(result.data?.[0].reference_number).toBe("X0012189541")
    })

    it("uses the supplied service type and COD fields", async () => {
      const fetchMock = mockFetch(
        mockResponse({
          status: "OK",
          data: [{ success: true, reference_number: "X0012189542" }],
        })
      )
      client = new DtdcClient({ ...opts, fetchImpl: fetchMock })

      await client.createShipment({
        service_type_id: "GROUND_EXPRESS",
        length: 10,
        width: 10,
        height: 10,
        weight: 1,
        declared_value: 1000,
        cod_collection_mode: "CASH",
        cod_amount: 1000,
        origin: {
          name: "W",
          phone: "1",
          address_line_1: "a",
          pincode: "110046",
          city: "c",
          state: "s",
        },
        destination: {
          name: "C",
          phone: "2",
          address_line_1: "b",
          pincode: "636010",
          city: "c",
          state: "s",
        },
        customer_reference_number: "ORDER-2",
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.consignments[0].service_type_id).toBe("GROUND_EXPRESS")
      expect(body.consignments[0].cod_collection_mode).toBe("CASH")
      expect(body.consignments[0].cod_amount).toBe("1000")
    })
  })

  describe("cancelShipment", () => {
    it("posts the awb and customer code", async () => {
      const fetchMock = mockFetch(
        mockResponse({ status: "OK", success: true, successConsignments: [] })
      )
      client = new DtdcClient({ ...opts, fetchImpl: fetchMock })

      await client.cancelShipment("X0012189541")

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/customer/integration/consignment/cancel")
      expect(JSON.parse(init.body)).toEqual({
        AWBNo: ["X0012189541"],
        customerCode: "GL018",
      })
    })
  })

  describe("generateTrackingToken", () => {
    it("returns the pre-minted token when supplied", async () => {
      const clientWithToken = new DtdcClient({
        ...opts,
        tracking_access_token: "pre-minted-token",
        fetchImpl: jest.fn() as any,
      })
      const token = await clientWithToken.generateTrackingToken()
      expect(token).toBe("pre-minted-token")
    })

    it("mints a token from username/password (plain-string response)", async () => {
      const fetchMock = mockFetch(
        mockResponse("GL018_trk_json:bd45addb4aa09ea88364227a4f7b951b")
      )
      client = new DtdcClient({ ...opts, fetchImpl: fetchMock })

      const token = await client.generateTrackingToken()
      expect(token).toBe("GL018_trk_json:bd45addb4aa09ea88364227a4f7b951b")
      expect(fetchMock.mock.calls[0][0]).toContain(
        "username=GL018_trk_json&password=chwzf"
      )
    })

    it("tolerates a JSON-wrapped token if DTDC changes shape", async () => {
      const fetchMock = mockFetch(
        mockResponse({ data: { token: "json-wrapped-token" } })
      )
      client = new DtdcClient({ ...opts, fetchImpl: fetchMock })

      const token = await client.generateTrackingToken()
      expect(token).toBe("json-wrapped-token")
    })
  })

  describe("trackShipment", () => {
    it("parses trackHeader + trackDetails", async () => {
      const fetchMock = mockFetch(
        mockResponse({
          statusCode: 200,
          status: "SUCCESS",
          trackHeader: { strShipmentNo: "X0012189541", strStatus: "Pickup Awaited" },
          trackDetails: [],
        })
      )
      client = new DtdcClient({
        ...opts,
        tracking_access_token: "pre-minted-token",
        fetchImpl: fetchMock,
      })

      const result = await client.trackShipment("X0012189541")
      expect(result.trackHeader?.strShipmentNo).toBe("X0012189541")
      expect(result.trackHeader?.strStatus).toBe("Pickup Awaited")

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toContain("/JSONCnTrk/getTrackDetails")
      expect(init.headers["X-Access-Token"]).toBe("pre-minted-token")
    })
  })
})