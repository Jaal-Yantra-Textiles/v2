import type { RateOption } from "../../modules/shipping-providers/provider-interface"

/**
 * The decision rules for the storefront delivery check — which carrier answers
 * which question, and what the buyer is told when they disagree or fail.
 *
 * Pure (no container, no network) so every rule here is unit-tested.
 *
 *   serviceable  any carrier that answered says yes → yes. All that answered
 *                say no → no, UNLESS another carrier failed (it might have had
 *                a courier) → unknown.
 *   COD          India only. Delhivery is authoritative when it serves the pin.
 *                Otherwise a Shiprocket courier's own `cod` flag. Abroad: never
 *                (no carrier we use takes cash across a border).
 *   ETA          only from carriers that quote couriers (Shiprocket, ShipGlobal).
 *                Delhivery's pin lookup has no transit time.
 *   no carrier   fall back to the store's own shipping zones: "we ship to X",
 *                with no ETA and no COD answer.
 *   all failed   unknown + a soft message. Never an error to the storefront.
 */

export type EtaDays = { min: number; max: number }

export type CarrierAnswer =
  | {
      carrier: string
      status: "ok"
      serviceable: boolean
      /** null = this carrier can't say. */
      cod: boolean | null
      eta_days: EtaDays | null
      courier_count?: number
    }
  | { carrier: string; status: "error"; reason: string }
  | { carrier: string; status: "not_configured" }

export type DeliveryCheckResult = {
  serviceable: boolean | null
  cod_available: boolean | null
  eta_days: EtaDays | null
  message: string
  /** Carriers (or "store_shipping_zones") whose answer this is built from. */
  source: string[]
  country_code: string
  postal_code: string
  courier_count?: number
  /**
   * Delhivery's own COD flag for this PIN (null = not asked / no answer).
   * Courier cash on delivery follows Delhivery alone, not a Shiprocket courier
   * flag, so it is carried separately from the merged `cod_available`.
   */
  delhivery_cod?: boolean | null
}

/** Delhivery's COD answer out of the carrier answers, or null. */
export function delhiveryCodFromAnswers(answers: CarrierAnswer[]): boolean | null {
  const a = answers.find((x) => x.carrier === "delhivery")
  if (!a || a.status !== "ok") return null
  return a.serviceable ? a.cod === true : false
}

export const ZONE_SOURCE = "store_shipping_zones"

/**
 * An ETA range from a list of courier quotes. The fastest courier is the low
 * end; the high end is the RECOMMENDED courier (the one the label flow would
 * pick), not the slowest courier on the list — a 2-day air option next to a
 * 12-day surface one would otherwise read as "2-12 days", which tells the buyer
 * nothing. Falls back to the slowest when nothing is marked recommended.
 */
export function etaFromRates(rates: RateOption[] | null | undefined): EtaDays | null {
  const days = (rates ?? [])
    .map((r) => Number(r.estimated_days))
    .filter((d) => Number.isFinite(d) && d > 0)
  if (!days.length) return null
  const min = Math.min(...days)
  const recommended = (rates ?? []).find(
    (r) => r.is_recommended && Number(r.estimated_days) > 0
  )
  const max = recommended ? Number(recommended.estimated_days) : Math.max(...days)
  return { min: Math.round(min), max: Math.round(Math.max(min, max)) }
}

/** COD from a Shiprocket quote: true if any courier takes cash, null if none say. */
export function codFromRates(rates: RateOption[] | null | undefined): boolean | null {
  const flags = (rates ?? [])
    .map((r) => r.cod_available)
    .filter((f): f is boolean => typeof f === "boolean")
  if (!flags.length) return null
  return flags.some(Boolean)
}

export function countryName(iso: string): string {
  const code = String(iso || "").toUpperCase()
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code
  } catch {
    return code
  }
}

const etaText = (eta: EtaDays | null) => {
  if (!eta) return ""
  return eta.min === eta.max
    ? ` in about ${eta.min} day${eta.min === 1 ? "" : "s"}`
    : ` in ${eta.min}–${eta.max} days`
}

export function deliveryMessage(args: {
  serviceable: boolean | null
  eta_days: EtaDays | null
  country_code: string
  postal_code: string
  from_zones?: boolean
}): string {
  const domestic = args.country_code === "in"
  const place = domestic
    ? `PIN ${args.postal_code}`
    : args.postal_code
      ? `${args.postal_code}, ${countryName(args.country_code)}`
      : countryName(args.country_code)

  if (args.serviceable === null) {
    return domestic
      ? "We couldn't check this PIN code right now. You can still place your order."
      : "We couldn't check delivery to this address right now. You can still place your order."
  }
  if (args.serviceable === false) {
    return `Sorry, we don't deliver to ${place} yet.`
  }
  if (args.from_zones) {
    return `We ship to ${countryName(args.country_code)}.`
  }
  return `Delivers to ${place}${etaText(args.eta_days)}.`
}

export function mergeDeliveryAnswers(input: {
  country_code: string
  postal_code: string
  answers: CarrierAnswer[]
  /**
   * Does any of the store's shipping zones cover this country? Only consulted
   * when NO carrier is configured. null = could not tell.
   */
  zone_covers_country: boolean | null
}): DeliveryCheckResult {
  const country = String(input.country_code || "").toLowerCase()
  const domestic = country === "in"
  const base = { country_code: country, postal_code: input.postal_code }

  const ok = input.answers.filter(
    (a): a is Extract<CarrierAnswer, { status: "ok" }> => a.status === "ok"
  )
  const failed = input.answers.filter((a) => a.status === "error")
  const configured = input.answers.filter((a) => a.status !== "not_configured")

  // ---- No carrier configured: the store's own zones are the only answer ----
  if (!configured.length) {
    const serviceable = input.zone_covers_country
    return {
      ...base,
      serviceable,
      cod_available: domestic || serviceable === null ? null : false,
      eta_days: null,
      source: serviceable === null ? [] : [ZONE_SOURCE],
      message: deliveryMessage({
        serviceable,
        eta_days: null,
        ...base,
        from_zones: true,
      }),
    }
  }

  // ---- Every configured carrier failed ----
  if (!ok.length) {
    return {
      ...base,
      serviceable: null,
      cod_available: null,
      eta_days: null,
      source: [],
      message: deliveryMessage({ serviceable: null, eta_days: null, ...base }),
    }
  }

  const yes = ok.filter((a) => a.serviceable)
  const serviceable: boolean | null = yes.length
    ? true
    : failed.length
      ? null
      : false

  let cod: boolean | null
  if (!domestic) {
    cod = serviceable === null ? null : false
  } else if (serviceable === false) {
    cod = false
  } else {
    const delhivery = yes.find((a) => a.carrier === "delhivery")
    if (delhivery && delhivery.cod !== null) {
      cod = delhivery.cod
    } else {
      const flags = yes
        .map((a) => a.cod)
        .filter((c): c is boolean => typeof c === "boolean")
      cod = flags.length ? flags.some(Boolean) : null
    }
  }

  const etas = yes
    .map((a) => a.eta_days)
    .filter((e): e is EtaDays => !!e)
  const eta_days = serviceable && etas.length
    ? {
        min: Math.min(...etas.map((e) => e.min)),
        max: Math.max(...etas.map((e) => e.max)),
      }
    : null

  const courierCount = yes.reduce((n, a) => n + (a.courier_count ?? 0), 0)

  return {
    ...base,
    serviceable,
    cod_available: cod,
    eta_days,
    source: ok.map((a) => a.carrier),
    ...(courierCount ? { courier_count: courierCount } : {}),
    message: deliveryMessage({ serviceable, eta_days, ...base }),
  }
}
