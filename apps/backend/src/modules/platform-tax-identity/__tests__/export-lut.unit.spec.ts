import {
  daysUntilLutExpiry,
  resolveActiveExportLut,
  resolveExportIgstStatus,
  type PlatformExportLutRow,
} from "../resolve-lib"

/**
 * #1216 — export IGST resolution.
 *
 * The point of modelling an LUT as data with a validity window (rather than a
 * flag) is that it EXPIRES: RFD-11 covers one financial year and must be
 * re-furnished each April. A flag would keep claiming "B" the day after it
 * lapses, which is a false declaration nobody would notice. So the FY boundary is
 * the case these tests exist for — "active LUT ⇒ B" is the easy half.
 */

const FY_2026_27: PlatformExportLutRow = {
  id: "lut_1",
  arn: "AD070426000123A",
  financial_year: "2026-27",
  valid_from: "2026-04-01T00:00:00.000Z",
  valid_to: "2027-03-31T23:59:59.000Z",
  is_active: true,
}

const at = (iso: string) => new Date(iso)

describe("resolveExportIgstStatus", () => {
  it("declares B while an LUT is in force", () => {
    const r = resolveExportIgstStatus([FY_2026_27], at("2026-08-06T00:00:00Z"))
    expect(r.status).toBe("B")
    expect(r.lut?.arn).toBe("AD070426000123A")
  })

  it("declares C when no LUT has been furnished", () => {
    // Today's state: applied for, no ARN yet.
    for (const luts of [undefined, null, []]) {
      expect(resolveExportIgstStatus(luts).status).toBe("C")
    }
  })

  describe("the financial-year boundary", () => {
    it("declares B on the first and last covered instants", () => {
      expect(
        resolveExportIgstStatus([FY_2026_27], at("2026-04-01T00:00:00.000Z")).status
      ).toBe("B")
      expect(
        resolveExportIgstStatus([FY_2026_27], at("2027-03-31T23:59:59.000Z")).status
      ).toBe("B")
    })

    it("falls back to C the instant it lapses, without anyone touching the row", () => {
      const r = resolveExportIgstStatus([FY_2026_27], at("2027-04-01T00:00:01Z"))
      expect(r.status).toBe("C")
      expect(r.lut).toBeNull()
    })

    it("declares C before cover starts (filed early for next year)", () => {
      expect(
        resolveExportIgstStatus([FY_2026_27], at("2026-03-31T12:00:00Z")).status
      ).toBe("C")
    })

    it("rolls onto the renewal once the new FY begins", () => {
      const renewal: PlatformExportLutRow = {
        ...FY_2026_27,
        id: "lut_2",
        arn: "AD070427000456B",
        financial_year: "2027-28",
        valid_from: "2027-04-01T00:00:00.000Z",
        valid_to: "2028-03-31T23:59:59.000Z",
      }
      const both = [FY_2026_27, renewal]
      expect(
        resolveExportIgstStatus(both, at("2027-01-01T00:00:00Z")).lut?.arn
      ).toBe("AD070426000123A")
      expect(resolveExportIgstStatus(both, at("2027-06-01T00:00:00Z")).lut?.arn).toBe(
        "AD070427000456B"
      )
    })

    it("prefers the most recently furnished cover when windows overlap", () => {
      const overlapping: PlatformExportLutRow = {
        ...FY_2026_27,
        id: "lut_3",
        arn: "AD-NEWER",
        valid_from: "2026-06-01T00:00:00.000Z",
        valid_to: "2027-03-31T23:59:59.000Z",
      }
      expect(
        resolveExportIgstStatus([FY_2026_27, overlapping], at("2026-08-06T00:00:00Z"))
          .lut?.arn
      ).toBe("AD-NEWER")
    })
  })

  describe("never upgrades to B on bad data", () => {
    it.each([
      ["withdrawn", { is_active: false }],
      ["no ARN", { arn: "" }],
      ["blank ARN", { arn: "   " }],
      ["missing valid_to (would never expire)", { valid_to: null }],
      ["missing valid_from", { valid_from: null }],
      ["unparseable dates", { valid_from: "not-a-date", valid_to: "nope" }],
    ])("declares C when the row is %s", (_label, patch) => {
      const r = resolveExportIgstStatus(
        [{ ...FY_2026_27, ...patch } as PlatformExportLutRow],
        at("2026-08-06T00:00:00Z")
      )
      expect(r.status).toBe("C")
    })

    it("ignores a junk row but still honours a good one beside it", () => {
      const r = resolveExportIgstStatus(
        [{ ...FY_2026_27, id: "bad", arn: "" }, FY_2026_27],
        at("2026-08-06T00:00:00Z")
      )
      expect(r.status).toBe("B")
    })

    it("survives null entries in the list", () => {
      const r = resolveExportIgstStatus(
        [null as any, FY_2026_27, undefined as any],
        at("2026-08-06T00:00:00Z")
      )
      expect(r.status).toBe("B")
    })
  })

  it("accepts Date objects as well as ISO strings", () => {
    const r = resolveExportIgstStatus(
      [
        {
          ...FY_2026_27,
          valid_from: new Date("2026-04-01T00:00:00Z"),
          valid_to: new Date("2027-03-31T23:59:59Z"),
        },
      ],
      at("2026-08-06T00:00:00Z")
    )
    expect(r.status).toBe("B")
  })
})

describe("resolveActiveExportLut", () => {
  it("returns the row itself so callers can show the ARN they relied on", () => {
    const lut = resolveActiveExportLut([FY_2026_27], at("2026-08-06T00:00:00Z"))
    expect(lut).toMatchObject({ id: "lut_1", financial_year: "2026-27" })
  })

  it("returns null rather than a stale row once cover ends", () => {
    expect(resolveActiveExportLut([FY_2026_27], at("2028-01-01T00:00:00Z"))).toBeNull()
  })
})

describe("daysUntilLutExpiry", () => {
  it("counts down to the end of cover (what the reminder keys off)", () => {
    expect(daysUntilLutExpiry([FY_2026_27], at("2027-03-01T23:59:59.000Z"))).toBe(30)
    expect(daysUntilLutExpiry([FY_2026_27], at("2027-03-31T00:00:00.000Z"))).toBe(1)
  })

  it("is null when nothing is in force — there is no expiry to warn about", () => {
    // Already declaring the safe "C"; a reminder here would be noise.
    expect(daysUntilLutExpiry([], at("2026-08-06T00:00:00Z"))).toBeNull()
    expect(daysUntilLutExpiry([FY_2026_27], at("2028-01-01T00:00:00Z"))).toBeNull()
  })
})
