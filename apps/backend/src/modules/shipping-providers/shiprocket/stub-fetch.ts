/**
 * Deterministic Shiprocket transport for tests/CI (#647).
 *
 * Patching `global.fetch` in an integration spec does NOT reliably intercept the
 * in-process Medusa server's own fetch in CI — the route then hits the real
 * Shiprocket API with throwaway test creds and 401s. Instead, the resolver
 * injects this stub as the client's `fetchImpl` when `SHIPROCKET_STUB=1`, so the
 * server uses canned responses regardless of the global. It is inert in normal
 * operation (only constructed behind the env flag).
 *
 * Canned data mirrors a real `/auth/login`, `/settings/company/pickup` and
 * `/courier/serviceability/` shape; integration specs assert against these.
 */
import type { FetchLike } from "./client"

const json = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any

/**
 * Captures what the stub last received, so integration specs can assert the
 * exact payload the client would send to Shiprocket (billing address, order_items
 * SKUs, L/B/H) end-to-end. Reset it in a test's `beforeEach` when needed.
 */
export const shiprocketStubState: {
  lastAdhocBody?: any
  lastPickupBody?: any
  lastAddPickupBody?: any
  /** International create/adhoc body (#1111). Also mirrored onto lastAdhocBody. */
  lastIntlAdhocBody?: any
} = {}

const parseBody = (init: any): any => {
  try {
    return init?.body ? JSON.parse(init.body) : undefined
  } catch {
    return undefined
  }
}

export function createShiprocketStubFetch(): FetchLike {
  return async (input: any, init?: any) => {
    const url = String(input)

    if (url.endsWith("/auth/login")) {
      return json({ token: "stub-token" })
    }

    // International create/adhoc (#1111) — must precede the generic
    // "/orders/create/adhoc" match below. Capture into lastIntlAdhocBody AND
    // mirror onto lastAdhocBody so existing pickup assertions keep working.
    if (url.endsWith("/international/orders/create/adhoc")) {
      const body = parseBody(init)
      shiprocketStubState.lastIntlAdhocBody = body
      shiprocketStubState.lastAdhocBody = body
      return json({ order_id: 9101, shipment_id: 8101 })
    }

    // International courier serviceability (#1111) — recommend an intl courier.
    if (url.includes("/international/courier/serviceability")) {
      return json({
        data: {
          recommended_courier_company_id: 301,
          available_courier_companies: [
            {
              courier_company_id: 301,
              courier_name: "DHL Express Intl",
              rate: 1450,
              currency: "INR",
              estimated_delivery_days: "6",
            },
          ],
        },
      })
    }

    if (url.endsWith("/international/courier/assign/awb")) {
      return json({
        response: {
          data: {
            awb_code: "STUBAWB123",
            courier_company_id: 301,
            courier_name: "DHL Express Intl",
          },
        },
      })
    }

    // Adhoc order create — capture the body (the whole point of the #864/#866/#869
    // end-to-end assertions) and return a shipment id.
    if (url.endsWith("/orders/create/adhoc")) {
      shiprocketStubState.lastAdhocBody = parseBody(init)
      return json({ order_id: 9001, shipment_id: 8001 })
    }

    if (url.endsWith("/courier/assign/awb")) {
      return json({
        response: {
          data: {
            awb_code: "STUBAWB123",
            courier_company_id: 51,
            courier_name: "Xpressbees Surface",
          },
        },
      })
    }

    if (url.endsWith("/courier/generate/label")) {
      return json({ label_url: "https://shiprocket.stub/label.pdf" })
    }

    if (url.endsWith("/courier/generate/pickup")) {
      shiprocketStubState.lastPickupBody = parseBody(init)
      return json({
        response: {
          pickup_scheduled_date: "2026-07-05 10:00:00",
          pickup_token_number: 555,
        },
      })
    }

    // Pickup registration — must precede the list match below ("addpickup"
    // would otherwise 404). Captures the body so specs can assert the pickup
    // the shipment flow registered (from_location fix).
    if (url.endsWith("/settings/company/addpickup")) {
      shiprocketStubState.lastAddPickupBody = parseBody(init)
      return json({ success: true, address: { id: 2 } })
    }

    if (url.includes("/settings/company/pickup")) {
      return json({
        data: {
          shipping_address: [
            {
              pickup_location: "warehouse-primary",
              phone_verified: 1,
              address: "1 Mill Road",
              phone: "9999999999",
              city: "Jaipur",
              state: "RJ",
              pin_code: "302001",
              id: 1,
            },
          ],
        },
      })
    }

    if (url.includes("/courier/serviceability/")) {
      return json({
        data: {
          recommended_courier_company_id: 51,
          available_courier_companies: [
            {
              courier_company_id: 51,
              courier_name: "Xpressbees Surface",
              rate: 78,
              estimated_delivery_days: "4",
              cod_charges: 35,
            },
            {
              courier_company_id: 12,
              courier_name: "Delhivery Air",
              rate: 121,
              estimated_delivery_days: "2",
              cod_charges: 40,
            },
          ],
        },
      })
    }

    return json({}, 404)
  }
}
