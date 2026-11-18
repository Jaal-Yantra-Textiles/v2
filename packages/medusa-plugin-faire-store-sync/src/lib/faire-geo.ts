import type { FaireGeoConstraint } from "./types"

/**
 * Faire variant prices are geo-scoped (`geo_constraint`), and Faire only sells
 * into a fixed set of markets. A `country` must be ISO-3166 alpha-3 — Faire
 * rejects alpha-2 with "IN is not a supported ISO-3166 Alpha-3 country code.
 * Valid countries are: USA, CAN, GBR, AUS". Eurozone prices use the
 * EUROPEAN_UNION country group.
 *
 * Any other currency (INR, AED, CHF, …) has no Faire market: it maps to null
 * and its price row is left out rather than sent and refused.
 */
const FAIRE_GEO_BY_CURRENCY: Record<string, FaireGeoConstraint> = {
  EUR: { country_group: "EUROPEAN_UNION" },
  USD: { country: "USA" },
  GBP: { country: "GBR" },
  CAD: { country: "CAN" },
  AUD: { country: "AUS" },
}

export const FAIRE_SUPPORTED_CURRENCIES = Object.keys(FAIRE_GEO_BY_CURRENCY)

export const geoForCurrency = (currency: string): FaireGeoConstraint | null =>
  FAIRE_GEO_BY_CURRENCY[String(currency || "").toUpperCase()] ?? null
