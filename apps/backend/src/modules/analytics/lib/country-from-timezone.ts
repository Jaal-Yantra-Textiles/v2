/**
 * Browser-side country capture (#559 slice 6).
 *
 * Now that the Cloudflare edge worker (which supplied `request.cf.country`) is
 * retired, we derive a visitor's country WITHOUT a paid GeoIP/edge service by
 * reading the browser's IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 * The client sends that `timezone` (and `locale`) on every track call; the
 * backend maps it to an ISO 3166-1 alpha-2 country code here.
 *
 * Country resolution precedence (see `resolveEventCountry`):
 *   1. client-supplied `country` (rare; e.g. an edge/proxy that still sets it)
 *   2. `countryFromTimezone(timezone)`  ← the new browser signal
 *   3. server GeoIP-of-IP fallback (`geoip-lite`, unchanged)
 *
 * These helpers are PURE (no I/O, no framework) so they unit-test trivially and
 * can run in both the synchronous and Redis-drained ingestion paths.
 */

/**
 * Curated IANA time zone → ISO 3166-1 alpha-2 map.
 *
 * Derived from the tz database `zone.tab` country column, trimmed to the zones a
 * real browser actually reports. Zones not listed resolve to `null`, which lets
 * the GeoIP fallback take over — so an incomplete map degrades gracefully rather
 * than mislabelling. India/US/EU/SEA coverage is intentionally dense (primary
 * traffic); long-tail zones can be appended as they show up in `/breakdown`.
 */
export const TIMEZONE_COUNTRY: Record<string, string> = {
  // --- India (primary market) ---
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",

  // --- North America ---
  "America/New_York": "US",
  "America/Detroit": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Phoenix": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "America/Adak": "US",
  "Pacific/Honolulu": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Edmonton": "CA",
  "America/Winnipeg": "CA",
  "America/Halifax": "CA",
  "America/Mexico_City": "MX",
  "America/Tijuana": "MX",
  "America/Monterrey": "MX",

  // --- South America ---
  "America/Sao_Paulo": "BR",
  "America/Bahia": "BR",
  "America/Fortaleza": "BR",
  "America/Manaus": "BR",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Santiago": "CL",
  "America/Bogota": "CO",
  "America/Lima": "PE",
  "America/Caracas": "VE",

  // --- Europe ---
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Europe/Madrid": "ES",
  "Europe/Paris": "FR",
  "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL",
  "Europe/Berlin": "DE",
  "Europe/Zurich": "CH",
  "Europe/Rome": "IT",
  "Europe/Vienna": "AT",
  "Europe/Copenhagen": "DK",
  "Europe/Oslo": "NO",
  "Europe/Stockholm": "SE",
  "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ",
  "Europe/Budapest": "HU",
  "Europe/Athens": "GR",
  "Europe/Bucharest": "RO",
  "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA",
  "Europe/Moscow": "RU",
  "Europe/Istanbul": "TR",

  // --- Middle East ---
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW",
  "Asia/Jerusalem": "IL",
  "Asia/Tehran": "IR",
  "Asia/Baghdad": "IQ",

  // --- South & Central Asia ---
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Kathmandu": "NP",
  "Asia/Colombo": "LK",
  "Asia/Tashkent": "UZ",

  // --- East & Southeast Asia ---
  "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Taipei": "TW",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Singapore": "SG",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Manila": "PH",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",

  // --- Oceania ---
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Australia/Adelaide": "AU",
  "Pacific/Auckland": "NZ",

  // --- Africa ---
  "Africa/Cairo": "EG",
  "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG",
  "Africa/Nairobi": "KE",
  "Africa/Casablanca": "MA",
  "Africa/Algiers": "DZ",
  "Africa/Accra": "GH",
};

/**
 * Map an IANA time zone (as reported by the browser) to an ISO 3166-1 alpha-2
 * country code. Returns `null` for unknown/empty/malformed input so the caller
 * can fall through to the next precedence tier.
 *
 * Matching is case-insensitive on the region/city but preserves the canonical
 * map key casing; only exact zone matches resolve (no fuzzy prefixing).
 */
export function countryFromTimezone(tz?: string | null): string | null {
  if (!tz || typeof tz !== "string") return null;
  const trimmed = tz.trim();
  if (!trimmed) return null;

  // Fast path: exact canonical match.
  if (TIMEZONE_COUNTRY[trimmed]) return TIMEZONE_COUNTRY[trimmed];

  // Case-insensitive match (browsers always send canonical casing, but proxies
  // and odd clients occasionally lowercase it).
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(TIMEZONE_COUNTRY)) {
    if (key.toLowerCase() === lower) return TIMEZONE_COUNTRY[key];
  }

  return null;
}

/**
 * Resolve the final country for an analytics event by precedence:
 *   client country → countryFromTimezone(timezone) → GeoIP-of-IP fallback.
 *
 * `ipCountry` is the already-computed `geoip-lite` result (passed in so this
 * stays pure and the lookup happens once at the call site). Any empty/whitespace
 * value at a tier is skipped. Returns `null` when no tier resolves.
 */
export function resolveEventCountry(opts: {
  clientCountry?: string | null;
  timezone?: string | null;
  ipCountry?: string | null;
}): string | null {
  const client = opts.clientCountry?.trim();
  if (client) return client;

  const fromTz = countryFromTimezone(opts.timezone);
  if (fromTz) return fromTz;

  const ip = opts.ipCountry?.trim();
  if (ip) return ip;

  return null;
}
