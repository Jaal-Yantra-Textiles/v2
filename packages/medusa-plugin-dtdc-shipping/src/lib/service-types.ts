/**
 * DTDC service types.
 *
 * The plugin was written against a sandbox account that offers two —
 * `PRIORITY` and `GROUND_EXPRESS` — and the union was closed around them. The
 * live account offers four more, all `B2C …`, and the credentials handover
 * listed them as one string:
 *
 *   "B2C SMART EXPRESS, B2C PRIORITY, B2C PREMIUM, B2C GROUND ECONOMY"
 *
 * None of those matched the union, so none could be configured, and because the
 * value arrives from `process.env` as a plain string nothing type-checked the
 * mismatch — it would have been sent to DTDC verbatim and refused there.
 *
 * 🔴 A live example of exactly that: the existing config carries
 * `DTDC_DEFAULT_SERVICE_TYPE=GROUND EXPRESS` — with a SPACE — while the union
 * says `GROUND_EXPRESS`. It typechecked because it never met the type.
 * `resolveDtdcServiceType` now normalises separators, so that value resolves
 * instead of reaching the carrier as an unknown code.
 *
 * ⚠️ The wire strings for the four `B2C` types are DTDC's own, used verbatim as
 * supplied. They have NOT been confirmed against a live booking — only the two
 * sandbox values have. If a prod booking is refused on `service_type_id`, this
 * table is the first place to look, not the payload.
 */

/**
 * Every service type this plugin will send, keyed by a stable name.
 *
 * The value is what goes on the wire. `GROUND_EXPRESS` keeps its underscore and
 * the `B2C` ones keep their spaces because that is how each was given to us —
 * normalising them to one style would be inventing a format.
 */
export const DTDC_SERVICE_TYPES = {
  PRIORITY: "PRIORITY",
  GROUND_EXPRESS: "GROUND_EXPRESS",
  B2C_SMART_EXPRESS: "B2C SMART EXPRESS",
  B2C_PRIORITY: "B2C PRIORITY",
  B2C_PREMIUM: "B2C PREMIUM",
  B2C_GROUND_ECONOMY: "B2C GROUND ECONOMY",
} as const

export type DtdcServiceTypeName = keyof typeof DTDC_SERVICE_TYPES
export type DtdcServiceType =
  (typeof DTDC_SERVICE_TYPES)[DtdcServiceTypeName]

/** What a consignment ships as when nothing is configured. */
export const DTDC_DEFAULT_SERVICE_TYPE: DtdcServiceType =
  DTDC_SERVICE_TYPES.PRIORITY

/** Lookup keyed by the separator-insensitive form of both name and wire value. */
const canonical = (v: string) =>
  v.trim().toUpperCase().replace(/[\s_-]+/g, "_")

const BY_CANONICAL: Record<string, DtdcServiceType> = Object.entries(
  DTDC_SERVICE_TYPES
).reduce((acc, [name, wire]) => {
  acc[canonical(name)] = wire
  acc[canonical(wire)] = wire
  return acc
}, {} as Record<string, DtdcServiceType>)

/**
 * Resolve a configured service type to the exact string DTDC expects.
 *
 * Separator- and case-insensitive, so `GROUND EXPRESS`, `ground_express` and
 * `Ground-Express` all reach `GROUND_EXPRESS`, and `b2c priority` reaches
 * `B2C PRIORITY`.
 *
 * 🔑 Returns null for anything unrecognised rather than passing it through.
 * Unlike a commodity id — where the list is DTDC's and grows, so an unknown
 * number is probably valid — the service types are a closed set per account,
 * and an unknown one is a typo. Sending it would be refused at booking time
 * with an error about the shipment rather than about the configuration.
 */
export function resolveDtdcServiceType(
  value?: string | null
): DtdcServiceType | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  return BY_CANONICAL[canonical(raw)] ?? null
}
