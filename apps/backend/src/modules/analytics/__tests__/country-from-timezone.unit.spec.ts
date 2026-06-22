import {
  countryFromTimezone,
  resolveEventCountry,
  TIMEZONE_COUNTRY,
} from "../country-from-timezone";

describe("country-from-timezone (#559 slice 6)", () => {
  describe("countryFromTimezone", () => {
    it("maps the primary India zones", () => {
      expect(countryFromTimezone("Asia/Kolkata")).toBe("IN");
      expect(countryFromTimezone("Asia/Calcutta")).toBe("IN");
    });

    it("maps common US/EU/SEA zones", () => {
      expect(countryFromTimezone("America/New_York")).toBe("US");
      expect(countryFromTimezone("America/Los_Angeles")).toBe("US");
      expect(countryFromTimezone("Europe/London")).toBe("GB");
      expect(countryFromTimezone("Europe/Berlin")).toBe("DE");
      expect(countryFromTimezone("Asia/Singapore")).toBe("SG");
      expect(countryFromTimezone("Australia/Sydney")).toBe("AU");
    });

    it("is case-insensitive on odd client/proxy casing", () => {
      expect(countryFromTimezone("asia/kolkata")).toBe("IN");
      expect(countryFromTimezone("EUROPE/LONDON")).toBe("GB");
    });

    it("trims surrounding whitespace", () => {
      expect(countryFromTimezone("  Asia/Tokyo  ")).toBe("JP");
    });

    it("returns null for unknown/empty/malformed input", () => {
      expect(countryFromTimezone("Mars/Phobos")).toBeNull();
      expect(countryFromTimezone("")).toBeNull();
      expect(countryFromTimezone("   ")).toBeNull();
      expect(countryFromTimezone(undefined)).toBeNull();
      expect(countryFromTimezone(null)).toBeNull();
      // @ts-expect-error — guard against non-string runtime input
      expect(countryFromTimezone(123)).toBeNull();
    });

    it("every map value is a 2-letter uppercase ISO code", () => {
      for (const code of Object.values(TIMEZONE_COUNTRY)) {
        expect(code).toMatch(/^[A-Z]{2}$/);
      }
    });
  });

  describe("resolveEventCountry precedence", () => {
    it("prefers the client-supplied country above all", () => {
      expect(
        resolveEventCountry({
          clientCountry: "FR",
          timezone: "Asia/Kolkata",
          ipCountry: "US",
        })
      ).toBe("FR");
    });

    it("falls to timezone when client country is missing", () => {
      expect(
        resolveEventCountry({
          clientCountry: undefined,
          timezone: "Asia/Kolkata",
          ipCountry: "US",
        })
      ).toBe("IN");
    });

    it("treats blank/whitespace client country as absent", () => {
      expect(
        resolveEventCountry({
          clientCountry: "   ",
          timezone: "Europe/Paris",
          ipCountry: "US",
        })
      ).toBe("FR");
    });

    it("falls to GeoIP-of-IP when client + timezone both miss", () => {
      expect(
        resolveEventCountry({
          clientCountry: undefined,
          timezone: "Mars/Phobos",
          ipCountry: "US",
        })
      ).toBe("US");
    });

    it("returns null when no tier resolves", () => {
      expect(
        resolveEventCountry({
          clientCountry: undefined,
          timezone: undefined,
          ipCountry: undefined,
        })
      ).toBeNull();
      expect(
        resolveEventCountry({
          clientCountry: "",
          timezone: "Nowhere/Nope",
          ipCountry: "  ",
        })
      ).toBeNull();
    });
  });
});
