/**
 * Deterministic StarFleet (Delhivery International) transport for tests/CI.
 *
 * StarFleet has no sandbox; the account credentials are live, so an un-stubbed
 * call would manifest a real, billable cross-border waybill. Mirroring
 * Shiprocket/ShipGlobal (#647), the resolver injects this stub when
 * `STARFLEET_STUB=1`.
 *
 * Canned shapes mirror the LIVE responses captured from the carrier (auth token,
 * batch job id → COMPLETED success_waybills, auth-track scans).
 */
import type { FetchLike } from "./client"

const json = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  }) as any

const STUB_AWB = "DLSTUB0000XB"

/** Captures what the stub last received so specs can assert the exact payload. */
export const starfleetStubState: {
  lastAuthBody?: any
  lastBatchBody?: any
  lastTrackPath?: string
  lastLabelPath?: string
  lastKycPath?: string
} = {}

const parseBody = (init: any): any => {
  try {
    return init?.body ? JSON.parse(init.body) : undefined
  } catch {
    return init?.body ?? undefined
  }
}

export function createStarfleetStubFetch(): FetchLike {
  return async (input: any, init?: any) => {
    const url = String(input)

    if (url.endsWith("/auth/token")) {
      starfleetStubState.lastAuthBody = parseBody(init)
      return json({ access_token: "stub-access-token", expires_in: 86400, token_type: "Bearer" })
    }

    if (url.endsWith("/batchGeneratePackages") && init?.method === "POST") {
      starfleetStubState.lastBatchBody = parseBody(init)
      return json({ message: "ok", payload: { id: "stub-job-id" } })
    }

    if (url.includes("/batchGeneratePackages/")) {
      return json({
        message: "ok",
        payload: {
          status: "COMPLETED",
          data: {
            total_count: 1,
            error_count: 0,
            success_count: 1,
            success_waybills: [
              { waybill: STUB_AWB, order_id: "stub-order", reason: "manifested" },
            ],
            error_waybills: [],
          },
        },
      })
    }

    if (url.includes("/auth-track/")) {
      starfleetStubState.lastTrackPath = url
      return json({
        message: "ok",
        payload: {
          waybills_found: [
            {
              waybill: STUB_AWB,
              origin: "testwarehouse",
              scans: [
                {
                  city: "IN_Delhi_P",
                  state: "Delhi",
                  country: "IND",
                  time: "1788343161",
                  action: "INT-PKG-MANF",
                  remarks: "Package Manifestation Done",
                },
              ],
            },
          ],
          waybills_not_found: [],
        },
      })
    }

    if (url.endsWith("/shipping-label")) {
      starfleetStubState.lastLabelPath = url
      return {
        ok: true,
        status: 200,
        text: async () => "",
        arrayBuffer: async () => Buffer.from("%PDF-1.4 stub label"),
      } as any
    }

    if (url.endsWith("/invoice")) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        arrayBuffer: async () => Buffer.from("%PDF-1.4 stub invoice"),
      } as any
    }

    if (url.endsWith("/upload-kyc-doc")) {
      starfleetStubState.lastKycPath = url
      return json({ success: true, message: "ok" })
    }

    return json({ message: "stub: not found" }, 404)
  }
}