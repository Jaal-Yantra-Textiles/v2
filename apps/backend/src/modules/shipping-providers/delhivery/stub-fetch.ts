/**
 * Deterministic Delhivery transport for tests/CI (`DELHIVERY_STUB=1`).
 *
 * Delhivery has **no usable sandbox** — `staging-express` 401s our live token —
 * so every real `create` mints a BILLABLE waybill on the live account. Creation
 * behaviour therefore has to be verified against a stub. Patching `global.fetch`
 * in an integration spec does not reliably intercept the in-process Medusa
 * server's own fetch (#647), so the transport is injected as the client's
 * `fetchImpl` instead. Inert in normal operation — only constructed behind the
 * env flag.
 *
 * The stub enforces the ONE invariant this whole fix is about, rather than
 * canning a fixed response: `/api/cmu/create.json` refuses any manifest whose
 * `pickup_location.name` was not previously registered through
 * `/api/backend/clientwarehouse/create/`, reproducing Delhivery's exact wording
 * (`ClientWarehouse matching query does not exist.`) — the failure that left
 * order #83 holding a fulfillment with an empty waybill. A test that passes
 * against this stub has genuinely proved the registration path, not a string.
 *
 * Matching is EXACT and CASE-SENSITIVE, as Delhivery's docs specify.
 */

const json = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any

export const delhiveryStubState: {
  /** Warehouse names registered in this run — the stub's whole source of truth. */
  registeredWarehouses: Set<string>
  lastWarehouseBody?: any
  /** The decoded `data` payload of the last `/api/cmu/create.json` call. */
  lastManifestBody?: any
  /** Override the waybill the stub assigns (default STUBWBN123). */
  waybillOverride?: string
} = { registeredWarehouses: new Set<string>() }

/** Reset between specs so one test's registrations can't satisfy another's. */
export const resetDelhiveryStub = () => {
  delhiveryStubState.registeredWarehouses = new Set<string>()
  delhiveryStubState.lastWarehouseBody = undefined
  delhiveryStubState.lastManifestBody = undefined
  delhiveryStubState.waybillOverride = undefined
}

const parseJsonBody = (init: any): any => {
  try {
    return init?.body ? JSON.parse(init.body) : undefined
  } catch {
    return undefined
  }
}

/**
 * `/api/cmu/create.json` is form-encoded as `format=json&data=<urlencoded json>`,
 * not JSON — decode it back so specs can assert the real manifest.
 */
const parseManifestBody = (init: any): any => {
  try {
    const params = new URLSearchParams(String(init?.body || ""))
    const data = params.get("data")
    return data ? JSON.parse(data) : undefined
  } catch {
    return undefined
  }
}

export function createDelhiveryStubFetch() {
  return async (input: string, init?: Record<string, any>): Promise<any> => {
    const url = String(input)

    // Register a warehouse. Delhivery requires names to be unique per account.
    if (url.includes("/api/backend/clientwarehouse/create/")) {
      const body = parseJsonBody(init)
      delhiveryStubState.lastWarehouseBody = body
      const name = String(body?.name || "")
      if (!name) {
        return json({ success: false, error: ["name is required"] }, 400)
      }
      if (delhiveryStubState.registeredWarehouses.has(name)) {
        return json(
          { success: false, error: ["Warehouse with this name already exists"] },
          400
        )
      }
      delhiveryStubState.registeredWarehouses.add(name)
      return json({ success: true, data: { name } })
    }

    if (url.includes("/api/backend/clientwarehouse/edit/")) {
      return json({ success: true })
    }

    // Manifest an order — the invariant under test.
    if (url.includes("/api/cmu/create.json")) {
      const payload = parseManifestBody(init)
      delhiveryStubState.lastManifestBody = payload
      const pickupName = String(payload?.pickup_location?.name || "")

      if (!delhiveryStubState.registeredWarehouses.has(pickupName)) {
        return json({
          success: false,
          rmk: "ClientWarehouse matching query does not exist.",
          error: true,
          packages: [],
          package_count: 0,
          upload_wbn: null,
        })
      }

      const waybill = delhiveryStubState.waybillOverride || "STUBWBN123"
      return json({
        success: true,
        upload_wbn: waybill,
        package_count: 1,
        packages: [
          {
            status: "Success",
            waybill,
            refnum: payload?.shipments?.[0]?.order || "",
            remarks: [],
          },
        ],
      })
    }

    if (url.includes("/c/api/pin-codes/json/")) {
      return json({
        delivery_codes: [
          { postal_code: { pin: 470226, pre_paid: "Y", cash: "Y", cod: "Y" } },
        ],
      })
    }

    if (url.includes("/api/kinko/v1/invoice/charges/")) {
      return json([{ total_amount: 85, charge_DL: 70, charge_COD: 0 }])
    }

    if (url.includes("/waybill/api/fetch/")) {
      return json({ raw: delhiveryStubState.waybillOverride || "STUBWBN123" })
    }

    if (url.includes("/api/v1/packages/json/")) {
      return json({
        ShipmentData: [
          {
            Shipment: {
              AWB: delhiveryStubState.waybillOverride || "STUBWBN123",
              Status: { Status: "In Transit", StatusType: "UD" },
              Scans: [],
            },
          },
        ],
      })
    }

    if (url.includes("/api/p/packing_slip")) {
      return json({ packages: [{ pdf_download_link: "https://stub.invalid/label.pdf" }] })
    }

    if (url.includes("/fm/request/new/")) {
      return json({ pickup_id: 999001, pr_exist: false })
    }

    if (url.includes("/api/p/edit")) {
      return json({ success: true })
    }

    return json({ success: false, rmk: `Unstubbed Delhivery endpoint: ${url}` }, 404)
  }
}
