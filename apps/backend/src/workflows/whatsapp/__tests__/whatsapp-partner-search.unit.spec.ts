/**
 * #2106 — an admin on WhatsApp asking for a partner by name.
 *
 * The regression here is not "the search was small". It is that a FULL page
 * and a genuine absence produced the identical sentence — `Partner "sharlho"
 * not found.` — so 26 of 31 partners read as non-existent to the only person
 * who could have noticed.
 */
import {
  searchPartners,
  describeAmbiguous,
  describeNotFound,
  PARTNER_SEARCH_PAGE,
} from "../whatsapp-partner-search"

const P = (name: string, handle = name.toLowerCase(), id = `p_${handle}`) => ({
  id,
  name,
  handle,
})

const THIRTY_ONE = [
  P("Sharlho"),
  P("Bhuttico"),
  P("Unique Pashmina", "unique-pashmina"),
  P("Ielo craft", "ielo"),
  P("Raja Shawls", "raja-shawls"),
  P("Ghosh and Organic Fashionary", "gof"),
  P("Woven Futures", "woven"),
  ...Array.from({ length: 24 }, (_, i) => P(`Filler ${i}`, `filler-${i}`)),
]

describe("searchPartners", () => {
  /*
   * The exact defect. Under the old `take: 5`, a partner sitting at row 6+ was
   * unreachable — and these are the partners we actually transact with.
   */
  it.each(["Sharlho", "Ghosh and Organic Fashionary", "Woven Futures"])(
    "finds %s, which the old five-row read could never reach",
    (name) => {
      const found = searchPartners(THIRTY_ONE, name)
      expect(found).toMatchObject({ kind: "one" })
      expect((found as any).partner.name).toBe(name)
    }
  )

  it("matches case-insensitively and on a handle", () => {
    expect(searchPartners(THIRTY_ONE, "gof")).toMatchObject({
      kind: "one",
      partner: { name: "Ghosh and Organic Fashionary" },
    })
    expect(searchPartners(THIRTY_ONE, "SHARLHO")).toMatchObject({ kind: "one" })
  })

  it("matches on a substring of the name", () => {
    expect(searchPartners(THIRTY_ONE, "pashmina")).toMatchObject({
      kind: "one",
      partner: { name: "Unique Pashmina" },
    })
  })

  /*
   * 🔴 Never resolve a tie. Handing an admin one of two partners is the same
   * failure as the take:1 selectors — a plausible answer that is arbitrary.
   */
  it("reports several matches rather than picking one", () => {
    const rows = [P("Raja Shawls", "raja-shawls"), P("Raja Handloom", "raja-hl")]
    const found = searchPartners(rows, "raja")

    expect(found.kind).toBe("many")
    expect((found as any).partners).toHaveLength(2)
  })

  /*
   * But precision must survive ambiguity: an exact handle is an answer, even
   * when it is also a substring of something longer.
   */
  it("lets an exact handle win over a longer partial match", () => {
    const rows = [P("Raja", "raja"), P("Raja Shawls", "raja-shawls")]
    expect(searchPartners(rows, "raja")).toMatchObject({
      kind: "one",
      partner: { handle: "raja" },
    })
  })

  it("reports a full page as truncated — it may not have seen everything", () => {
    const full = Array.from({ length: 10 }, (_, i) => P(`X${i}`, `x-${i}`))
    expect(searchPartners(full, "nobody", 10)).toEqual({
      kind: "none",
      truncated: true,
    })
  })

  it("reports a partial page as a real absence", () => {
    expect(searchPartners(THIRTY_ONE, "nobody")).toEqual({
      kind: "none",
      truncated: false,
    })
  })

  it("treats an empty term as no match rather than matching everything", () => {
    expect(searchPartners(THIRTY_ONE, "   ")).toMatchObject({ kind: "none" })
  })

  it("survives junk rows without throwing", () => {
    expect(
      searchPartners([{ name: null, handle: undefined, id: null } as any], "x")
    ).toMatchObject({ kind: "none" })
  })
})

describe("describeNotFound", () => {
  /*
   * THE FIX, IN ONE ASSERTION. These two sentences must not be the same: only
   * one of them is entitled to claim the partner does not exist.
   */
  it("does not claim absence when the page was full", () => {
    const honest = describeNotFound("sharlho", true)
    const absent = describeNotFound("sharlho", false)

    expect(honest).not.toEqual(absent)
    expect(honest).toContain("there may be more I did not search")
    expect(honest).toContain(String(PARTNER_SEARCH_PAGE))
    expect(absent).toBe('Partner "sharlho" not found.')
  })
})

describe("describeAmbiguous", () => {
  it("names the candidates and asks the admin to choose", () => {
    const text = describeAmbiguous(
      [P("Raja Shawls", "raja-shawls"), P("Raja Handloom", "raja-hl")],
      "raja"
    )

    expect(text).toContain("matches 2 partners")
    expect(text).toContain("raja-shawls")
    expect(text).toContain("raja-hl")
    expect(text).toContain("Reply with the handle or id")
  })

  it("caps the list rather than pasting thirty lines onto a phone", () => {
    const many = Array.from({ length: 9 }, (_, i) => P(`Raja ${i}`, `raja-${i}`))
    const text = describeAmbiguous(many, "raja")

    expect(text).toContain("and 4 more")
    expect(text.split("•")).toHaveLength(6) // 5 bullets + the preamble
  })
})
