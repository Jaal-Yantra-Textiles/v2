/**
 * Deterministic ShipGlobal transport for tests/CI.
 *
 * ShipGlobal has no sandbox — the account credentials are live, so an un-stubbed
 * call would book a real, billable cross-border waybill. Mirroring Shiprocket's
 * `stub-fetch.ts` (#647), the resolver injects this stub as the client's
 * `fetchImpl` when `SHIPGLOBAL_STUB=1`, so the server uses canned responses
 * regardless of the global fetch (which can't be reliably patched across the
 * test ↔ in-process-server boundary).
 *
 * The canned shapes mirror the LIVE responses captured from the carrier
 * (rate `services[]`, base64 PDF label, `awb_`-prefixed tracking fields).
 */
import type { FetchLike } from "./client"

const json = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any

/** The base64 prefix of a minimal 1-byte PDF ("%PDF-1.4\n"). Real labels are a
 *  full PDF blob; tests only need to prove the base64 payload round-trips. */
const STUB_LABEL = "JVBERi0xLjQK"

/**
 * Captures what the stub last received so integration specs can assert the exact
 * payload the client would send to ShipGlobal (invoice/address split, item lines,
 * rate body). Reset in a test's `beforeEach` when needed.
 */
export const shipglobalStubState: {
  lastOrderBody?: any
  lastRateBody?: any
  lastLabelBody?: any
  lastTrackBody?: any
  lastCancelBody?: any
  /** Override the tracking number order/add returns (default STUBSG123). */
  awbOverride?: string
} = {}

const parseBody = (init: any): any => {
  try {
    return init?.body ? JSON.parse(init.body) : undefined
  } catch {
    return undefined
  }
}

export function createShipglobalStubFetch(): FetchLike {
  return async (input: any, init?: any) => {
    const url = String(input)
    const awb = shipglobalStubState.awbOverride || "STUBSG123"

    if (url.endsWith("/rates/calculate")) {
      shipglobalStubState.lastRateBody = parseBody(init)
      return json({
        success: true,
        billed_weight: 20,
        billed_weight_unit: "GM",
        currency: "INR",
        services: [
          {
            title: "ShipGlobal Direct",
            notes: "",
            transit_time: "7-10 Days",
            price: { logistic_fee: 285 },
            subtotal_fee: 300,
          },
          {
            title: "ShipGlobal First Class",
            notes: "",
            transit_time: "7-10 Days",
            price: { logistic_fee: 311 },
            subtotal_fee: 326,
          },
          {
            title: "UPS",
            notes: "Duties will be charged, if applicable.",
            transit_time: "4 - 7 Days",
            price: { logistic_fee: 2247 },
            subtotal_fee: 2247,
          },
        ],
      })
    }

    if (url.endsWith("/order/add")) {
      shipglobalStubState.lastOrderBody = parseBody(init)
      return json({ success: true, tracking: awb })
    }

    if (url.endsWith("/order/getLabel")) {
      shipglobalStubState.lastLabelBody = parseBody(init)
      return json({ success: true, tracking: awb, label: STUB_LABEL })
    }

    if (url.endsWith("/order/cancelRefundOrder")) {
      shipglobalStubState.lastCancelBody = parseBody(init)
      return json({ success: true })
    }

    if (url.endsWith("/tools/tracking")) {
      shipglobalStubState.lastTrackBody = parseBody(init)
      return json({
        success: true,
        data: {
          awbEvents: [
            {
              awb_history_id: "4277696",
              awb_id: 0,
              awb_history_datetime: "2023-10-03 10:46:11",
              awb_history_location: "San Jose, CA, US",
              awb_history_comment: "DELIVERED ",
              type: "lastmile",
              awb_history_code: 0,
              awb_event_code: "SGE_304",
            },
            {
              awb_history_id: "4161152",
              awb_id: 0,
              awb_history_datetime: "2023-09-28 15:11:03",
              awb_history_location: "Delhi, India",
              awb_history_comment: "Shipment Created, Awaiting Package",
              type: "domestic",
              awb_history_code: 0,
              awb_event_code: "SGE_001",
            },
          ],
          awbInfo: {
            awb_booking_date: "2023-09-28 15:11:03",
            awb_sender_name: "linkers",
            awb_destination: "US",
            awb_receiver_name: "LINKERS Att Fulfilment Centre",
            awb_number: awb,
            partner_lastmile_awb: "XXXXXXXXXX",
            awb_postcode: "11434",
            provider_logo:
              "https://app.shipglobal.in/assets/media/shipglobal/provider/sg.png",
            partner_lastmile_display: "UPS",
            partner_lastmile_tracking_url:
              "https://www.ups.com/track?loc=en_US&requester=QUIC&tracknum=XXXXXXXXXX/trackdetails",
            awb_status: "DELIVERED ",
          },
        },
      })
    }

    return json({}, 404)
  }
}