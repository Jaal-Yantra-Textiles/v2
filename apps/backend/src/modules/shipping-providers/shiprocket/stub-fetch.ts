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

export function createShiprocketStubFetch(): FetchLike {
  return async (input: any) => {
    const url = String(input)

    if (url.endsWith("/auth/login")) {
      return json({ token: "stub-token" })
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
