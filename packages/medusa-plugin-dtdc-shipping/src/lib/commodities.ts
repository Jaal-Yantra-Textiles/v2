/**
 * DTDC commodity ids.
 *
 * Every consignment declares WHAT is in the parcel via `commodity_id`. DTDC
 * publishes the list as a spreadsheet; these are the entries that matter for a
 * textile business, transcribed from it.
 *
 * 🔴 Why this file exists: `createShipment` defaulted `commodity_id` to `"2"`,
 * and `2` is **MOBILE**. Every waybill this plugin booked for a textile seller
 * declared the parcel as a mobile phone — a mis-declaration on a shipping
 * document, not a cosmetic default. It was invisible because DTDC accepts it:
 * the booking succeeds, the label prints, and only the paperwork is wrong.
 *
 * The default is now an OPTION, so the answer is chosen by the integrator
 * rather than inherited from whatever happened to be second in a list.
 */

/** The textile-relevant subset of DTDC's commodity list. */
export const DTDC_COMMODITIES = {
  CLOTHING: "38",
  UNSTITCHED_FABRIC_OR_SAREE: "56",
  LEATHER_GOODS: "152",
  BAGS: "94",
  DECORATIVE_ITEMS: "155",
  ARTIFICIAL_JEWELLERY: "17",
  SHOES: "67",
  SLIPPERS: "6",
  PAINTING_OR_ARTWORK: "45",
  STATIONERY: "87",
  BOOKS: "72",
  CORPORATE_GIFTS: "44",
  HOUSEHOLD_GOODS: "43",
  OTHERS: "7",
} as const

export type DtdcCommodityName = keyof typeof DTDC_COMMODITIES

/**
 * What a garment parcel is, absent anything more specific.
 *
 * ⚠️ Deliberately NOT `OTHERS`. "Others" is a real DTDC category and a lazy
 * declaration; `CLOTHING` is what these parcels actually contain, and an honest
 * commodity is what makes a claim payable.
 */
export const DTDC_DEFAULT_COMMODITY_ID = DTDC_COMMODITIES.CLOTHING

/**
 * Resolve a configured commodity to the id DTDC expects.
 *
 * Accepts either a raw numeric id (`"56"`) or one of the names above
 * (`"UNSTITCHED_FABRIC_OR_SAREE"`, case-insensitive), so config can be readable
 * without a lookup. Anything unrecognised returns null so the caller can fall
 * back rather than posting a made-up id onto a shipping document.
 */
export function resolveDtdcCommodityId(
  value?: string | null
): string | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null

  // A bare number is an id. Validate the SHAPE only — the list is DTDC's and
  // grows; refusing an id this file has not been updated for would be worse
  // than passing it through.
  if (/^\d+$/.test(raw)) return raw

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_") as DtdcCommodityName
  return DTDC_COMMODITIES[key] ?? null
}
