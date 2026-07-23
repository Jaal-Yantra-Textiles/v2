import type { CreateShipmentInput, ShipmentItem } from "../provider-interface"

/**
 * International currency handling for Shiprocket (#1111 S3).
 *
 * Shiprocket's international create/adhoc declares the commercial-invoice value
 * (sub_total + per-line selling_price) in a FIXED set of currencies — verified
 * against the account: INR, USD, GBP, EUR, AUD, CAD, SAR, AED, SGD. An order
 * priced in any other currency (e.g. THB, JPY, ZAR) can't be declared directly,
 * so the workflow converts the declared value into USD at the cached FX rate
 * before building the create body. The rate lookup is async I/O (FxRatesService)
 * and stays in the workflow; the conversion itself is pure and lives here.
 */

/** Currencies Shiprocket accepts for the international declared value. */
export const SHIPROCKET_SUPPORTED_CURRENCIES = new Set([
  "INR",
  "USD",
  "GBP",
  "EUR",
  "AUD",
  "CAD",
  "SAR",
  "AED",
  "SGD",
])

/** Hub currency unsupported order currencies are converted into. */
export const SHIPROCKET_FX_TARGET = "USD"

/** True when Shiprocket can declare customs value in this currency as-is. */
export function isShiprocketSupportedCurrency(code?: string | null): boolean {
  return SHIPROCKET_SUPPORTED_CURRENCIES.has(String(code || "").toUpperCase())
}

/**
 * Convert a shipment's declared value + line prices into `targetCurrency` at
 * `rate` (target units per 1 source unit), returning a NEW input — pure, so the
 * exact converted payload is unit-testable without the FX service. Amounts round
 * to 2 dp (a money value). `sub_total` and `cod_amount` convert independently of
 * the line prices (Shiprocket reads `sub_total` separately), matching the
 * domestic mapping's per-line vs sub_total split.
 */
export function convertShipmentCurrency(
  input: CreateShipmentInput,
  targetCurrency: string,
  rate: number
): CreateShipmentInput {
  const round2 = (n: number) => Math.round(n * 100) / 100
  const items: ShipmentItem[] = (input.items || []).map((i) => ({
    ...i,
    unit_price: round2((Number(i.unit_price) || 0) * rate),
  }))
  return {
    ...input,
    currency: targetCurrency.toUpperCase(),
    sub_total:
      input.sub_total != null ? round2(Number(input.sub_total) * rate) : undefined,
    cod_amount:
      input.cod_amount != null ? round2(Number(input.cod_amount) * rate) : undefined,
    items,
  }
}
