/**
 * Bidirectional address translation between Medusa internal format
 * and UCP postal_address.json format.
 *
 * Spec: https://ucp.dev/schemas/shopping/types/postal_address.json
 * UCP allows alpha-2, alpha-3, or full country name; Medusa requires
 * alpha-2 lowercase.
 */

export type MedusaAddress = {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export type UcpAddress = {
  first_name?: string
  last_name?: string
  street_address?: string
  extended_address?: string
  address_locality?: string
  address_region?: string
  address_country?: string
  postal_code?: string
  phone_number?: string
}

/** Common alpha-3 → alpha-2 mappings for countries we serve. */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  usa: "us", can: "ca", gbr: "gb", ind: "in", deu: "de", fra: "fr",
  ita: "it", esp: "es", nld: "nl", bel: "be", che: "ch", aut: "at",
  aus: "au", jpn: "jp", chn: "cn", kor: "kr", bra: "br", mex: "mx",
  rus: "ru", zaf: "za", sgp: "sg", hkg: "hk", are: "ae", sau: "sa",
  npl: "np", lka: "lk", bng: "bd", pak: "pk", tha: "th", vnm: "vn",
  idn: "id", mys: "my", phl: "ph", twn: "tw", nzl: "nz", irl: "ie",
  prt: "pt", swe: "se", nor: "no", dnk: "dk", fin: "fi", pol: "pl",
  cze: "cz", hun: "hu", grc: "gr", tur: "tr", isr: "il", egy: "eg",
}

/** Normalize various country representations to ISO 3166-1 alpha-2 lowercase. */
export function normalizeCountryCode(input: string | undefined | null): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()

  if (lower.length === 2) return lower
  if (lower.length === 3) return ALPHA3_TO_ALPHA2[lower] || null

  // Try full name → alpha-2 via a small lookup
  const fullNameMap: Record<string, string> = {
    "united states": "us", "united states of america": "us", "america": "us",
    "india": "in", "united kingdom": "gb", "britain": "gb", "england": "gb",
    "germany": "de", "france": "fr", "italy": "it", "spain": "es",
    "netherlands": "nl", "belgium": "be", "switzerland": "ch", "austria": "at",
    "australia": "au", "japan": "jp", "china": "cn", "south korea": "kr",
    "brazil": "br", "mexico": "mx", "canada": "ca", "singapore": "sg",
    "nepal": "np", "sri lanka": "lk", "bangladesh": "bd", "pakistan": "pk",
    "thailand": "th", "vietnam": "vn", "indonesia": "id", "malaysia": "my",
    "philippines": "ph", "taiwan": "tw", "new zealand": "nz", "ireland": "ie",
    "portugal": "pt", "sweden": "se", "norway": "no", "denmark": "dk",
    "finland": "fi", "poland": "pl", "czech republic": "cz", "hungary": "hu",
    "greece": "gr", "turkey": "tr", "israel": "il", "egypt": "eg",
    "south africa": "za", "russia": "ru", "hong kong": "hk",
    "united arab emirates": "ae", "saudi arabia": "sa",
  }
  return fullNameMap[lower] || null
}

export function medusaToUcpAddress(addr: MedusaAddress): UcpAddress {
  return {
    first_name: addr.first_name || undefined,
    last_name: addr.last_name || undefined,
    street_address: addr.address_1 || undefined,
    extended_address: addr.address_2 || undefined,
    address_locality: addr.city || undefined,
    address_region: addr.province || undefined,
    address_country: addr.country_code || undefined,
    postal_code: addr.postal_code || undefined,
    phone_number: addr.phone || undefined,
  }
}

export function ucpAddressToMedusa(addr: UcpAddress): MedusaAddress {
  const country = normalizeCountryCode(addr.address_country) || undefined
  return {
    first_name: addr.first_name || undefined,
    last_name: addr.last_name || undefined,
    address_1: addr.street_address || undefined,
    address_2: addr.extended_address || undefined,
    city: addr.address_locality || undefined,
    province: addr.address_region || undefined,
    postal_code: addr.postal_code || undefined,
    country_code: country,
    phone: addr.phone_number || undefined,
  }
}
