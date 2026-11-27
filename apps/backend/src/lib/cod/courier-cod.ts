import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import type { DelhiveryPinCodeResult } from "../../modules/shipping-providers/delhivery/adapter"

/**
 * Cash on delivery by COURIER (founder, 2026-11-27).
 *
 * Until now cash was pickup-only, and only the storefront enforced that. A
 * courier COD order is a parcel the carrier hands over before we have the
 * money, so the rule lives here and is checked again on the server when the
 * cart completes (see `workflows/hooks/require-courier-cod-eligibility.ts`).
 *
 * A courier COD order is allowed only when ALL of these hold:
 *  - the cart ships to India and is priced in INR (no carrier we use collects
 *    cash abroad);
 *  - Delhivery's pin-code lookup says this PIN takes COD. Delhivery is the
 *    authority, not a Shiprocket courier flag; if Delhivery can't be asked,
 *    the answer is no;
 *  - it is not a design order and has no deposit / payment schedule (those are
 *    paid by link, in parts);
 *  - the cart total is at or under the founder's COD cap.
 *
 * 🔑 The cap is the switch. `COD_COURIER_MAX_ORDER_TOTAL_INR` unset, blank, 0
 * or not a number means courier COD is OFF. That is deliberate: how much cash
 * a courier may carry for us is a money decision only the founder makes.
 */

export const COD_PROVIDER_PREFIX = "pp_system_default"

export const isCodProvider = (providerId: unknown): boolean =>
  typeof providerId === "string" && providerId.startsWith(COD_PROVIDER_PREFIX)

export type CourierCodReason =
  | "allowed"
  | "disabled"
  | "not_india"
  | "not_inr"
  | "design_order"
  | "payment_schedule"
  | "over_cap"
  | "pin_no_cod"
  | "pin_unknown"

export type CourierCodDecision = {
  allowed: boolean
  reason: CourierCodReason
  /** The cap in force, INR major units. null = courier COD is off. */
  max_total: number | null
}

/** The founder's cap in INR, or null when courier COD is off. */
export function courierCodMaxTotal(env: Record<string, string | undefined> = process.env): number | null {
  const raw = String(env.COD_COURIER_MAX_ORDER_TOTAL_INR ?? "").trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** PURE. Everything except the Delhivery call, so the rule is unit-testable. */
export function decideCourierCod(input: {
  country_code?: string | null
  currency_code?: string | null
  total: number | string | null | undefined
  is_design_order: boolean
  has_payment_schedule: boolean
  /** Delhivery's COD flag for the PIN. null = could not ask / no answer. */
  delhivery_cod: boolean | null
  max_total: number | null
}): CourierCodDecision {
  const max_total = input.max_total
  const no = (reason: CourierCodReason): CourierCodDecision => ({
    allowed: false,
    reason,
    max_total,
  })

  if (max_total == null) return no("disabled")
  if (String(input.country_code ?? "").trim().toLowerCase() !== "in") return no("not_india")
  if (String(input.currency_code ?? "").trim().toLowerCase() !== "inr") return no("not_inr")
  if (input.is_design_order) return no("design_order")
  if (input.has_payment_schedule) return no("payment_schedule")

  const total = Number(input.total)
  // A missing or non-numeric total is not "0, under the cap".
  if (input.total == null || input.total === "" || !Number.isFinite(total) || total <= 0) {
    return no("over_cap")
  }
  if (total > max_total) return no("over_cap")

  if (input.delhivery_cod === null) return no("pin_unknown")
  if (!input.delhivery_cod) return no("pin_no_cod")
  return { allowed: true, reason: "allowed", max_total }
}

/** What the buyer is told when the server refuses cash. */
export function courierCodRefusalMessage(d: CourierCodDecision): string {
  switch (d.reason) {
    case "over_cap":
      return d.max_total != null
        ? `Cash on delivery is available on orders up to ₹${d.max_total.toLocaleString("en-IN")}. Please pay online.`
        : "Cash on delivery isn't available for this order. Please pay online."
    case "pin_no_cod":
      return "Cash on delivery isn't available for this PIN code. Please pay online."
    case "pin_unknown":
      return "We couldn't confirm cash on delivery for this PIN code right now. Please pay online."
    default:
      return "Cash on delivery isn't available for this order. Please pay online."
  }
}

const DELHIVERY_TIMEOUT_MS = 8000

/** Delhivery's COD flag for a PIN. null when Delhivery is not set up, fails or times out. */
export async function delhiveryCodForPin(scope: any, pin: string): Promise<boolean | null> {
  const clean = String(pin ?? "").replace(/\s/g, "")
  if (!/^[1-9][0-9]{5}$/.test(clean)) return null
  try {
    const provider: any = await resolveShippingProvider(scope, "delhivery")
    const result = (await Promise.race([
      provider.checkPinCode(clean),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), DELHIVERY_TIMEOUT_MS)
      ),
    ])) as DelhiveryPinCodeResult
    return result?.cod === true
  } catch (e: any) {
    try {
      scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`[courier-cod] Delhivery pin lookup failed for ${clean}: ${e?.message || e}`)
    } catch {
      /* no logger */
    }
    return null
  }
}
