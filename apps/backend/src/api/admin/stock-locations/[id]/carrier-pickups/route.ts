import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import {
  getShiprocketPickupStatus,
  registerShiprocketPickup,
} from "../../../../../modules/shipping-providers/pickup-locations"
import {
  getDelhiveryWarehouseStatus,
  registerDelhiveryWarehouse,
} from "../../../../../modules/shipping-providers/delhivery-warehouses"

/**
 * Carrier pickup registration for a stock location, for BOTH carriers at once.
 *
 * A location has to be a registered pickup with a carrier before that carrier
 * will accept a shipment from it — Shiprocket 422s at `addpickup` time, while
 * Delhivery refuses the manifest with "ClientWarehouse matching query does not
 * exist." (the defect behind order #83). The two used to be invisible in
 * different ways: Shiprocket had a route and a widget, Delhivery had neither.
 *
 * One route serving both keeps the admin's mental model simple — "where can I
 * ship this location's goods from?" is one question, not two — and means a new
 * carrier shows up in the UI by extending `CARRIERS` rather than by adding
 * another route/widget pair.
 *
 *   GET  → status for every carrier (null status = never registered through us)
 *   POST → register one carrier (`{ carrier }`) or all of them (omit it)
 */

const CARRIERS = ["shiprocket", "delhivery"] as const
type Carrier = (typeof CARRIERS)[number]

const RegisterSchema = z.object({
  /** Omit to register every carrier this location isn't registered with yet. */
  carrier: z.enum(CARRIERS).optional(),
})

/** The logged-in admin's email, recorded as the carrier-side pickup contact. */
const resolveActorEmail = async (
  req: MedusaRequest
): Promise<string | undefined> => {
  try {
    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) return undefined
    const userService: any = req.scope.resolve(Modules.USER)
    const user = await userService.retrieveUser(actorId)
    return user?.email
  } catch {
    return undefined
  }
}

/**
 * Read one carrier's status without letting it fail the whole response.
 *
 * A carrier with no credentials configured throws from `resolveShippingProvider`;
 * that must not blank out the other carrier's perfectly good status, so the
 * error is reported per-carrier instead.
 */
const readStatus = async (req: MedusaRequest, carrier: Carrier) => {
  try {
    const status =
      carrier === "shiprocket"
        ? await getShiprocketPickupStatus(req.scope, req.params.id)
        : await getDelhiveryWarehouseStatus(req.scope, req.params.id)
    return { carrier, registered: Boolean(status), status }
  } catch (e: any) {
    return {
      carrier,
      registered: false,
      status: null,
      error: e?.message || "Could not read status",
    }
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pickups = await Promise.all(CARRIERS.map((c) => readStatus(req, c)))
  res.json({ pickups })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = RegisterSchema.safeParse(
    (req as any).validatedBody || req.body || {}
  )
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  const email = await resolveActorEmail(req)
  const targets: Carrier[] = parsed.data.carrier
    ? [parsed.data.carrier]
    : [...CARRIERS]

  // Registering "all" must not be all-or-nothing: one carrier's missing
  // credentials or incomplete address shouldn't discard the other's success.
  // A single explicitly-named carrier still throws, so the operator who asked
  // for that one gets the real error.
  const results = await Promise.all(
    targets.map(async (carrier) => {
      try {
        const result =
          carrier === "shiprocket"
            ? await registerShiprocketPickup(req.scope, req.params.id, { email })
            : await registerDelhiveryWarehouse(req.scope, req.params.id, { email })
        return { carrier, registered: true, status: result }
      } catch (e: any) {
        if (parsed.data.carrier) throw e
        return {
          carrier,
          registered: false,
          status: null,
          error: e?.message || "Registration failed",
        }
      }
    })
  )

  res.json({ pickups: results })
}
