import { describe, expect, it } from "vitest"

import {
  buildDialHref,
  buildQuotedHref,
  otherVariantLabel,
  parseDialledLines,
  serialiseDialledLines,
} from "../quote-lines"

/**
 * The buyer's dialled basket, in the URL (#1439 S13).
 *
 * Worth testing properly despite being small: this is the only client-side code
 * on the quote page that touches the basket at all, and both storefronts ship
 * with `ignoreBuildErrors: true`, so nothing else would catch a regression here
 * before a buyer did. The failures it guards against are all silent — a dropped
 * dial renders the quoted basket perfectly and simply ignores the buyer.
 */
describe("parseDialledLines", () => {
  it("reads the documented wire form", () => {
    expect(parseDialledLines("variant_01ABC:40,variant_01DEF:12")).toEqual([
      { variant_id: "variant_01ABC", quantity: 40 },
      { variant_id: "variant_01DEF", quantity: 12 },
    ])
  })

  it("is empty for an absent, blank or arrayed-empty param", () => {
    expect(parseDialledLines(undefined)).toEqual([])
    expect(parseDialledLines(null)).toEqual([])
    expect(parseDialledLines("")).toEqual([])
  })

  it("takes the first value when Next hands back a repeated param", () => {
    expect(parseDialledLines(["variant_a:2", "variant_a:9"])).toEqual([
      { variant_id: "variant_a", quantity: 2 },
    ])
  })

  it("drops a malformed pair rather than throwing the page away", () => {
    // A link mangled in an email client must cost the buyer the dial, never
    // their price — the quoted basket is always a correct answer.
    expect(parseDialledLines("variant_a:2,rubbish,:5,variant_b:")).toEqual([
      { variant_id: "variant_a", quantity: 2 },
    ])
  })

  it("refuses a quantity that cannot be manufactured, without clamping", () => {
    // 🔴 Not rounded to something nearby: silently substituting a number the
    // buyer did not type is how someone orders a quantity nobody chose.
    expect(parseDialledLines("variant_a:2.5,variant_b:-3,variant_c:abc")).toEqual([])
  })

  it("keeps a zero — the backend reads it as 'remove this line'", () => {
    expect(parseDialledLines("variant_a:0")).toEqual([
      { variant_id: "variant_a", quantity: 0 },
    ])
  })

  it("lets the first mention of a variant win", () => {
    // Otherwise the page and a re-read of its own URL could disagree about
    // what was asked for.
    expect(parseDialledLines("variant_a:2,variant_a:80")).toEqual([
      { variant_id: "variant_a", quantity: 2 },
    ])
  })

  it("round-trips through serialise", () => {
    const lines = [
      { variant_id: "variant_01ABC", quantity: 40 },
      { variant_id: "variant_01DEF", quantity: 1 },
    ]
    expect(parseDialledLines(serialiseDialledLines(lines))).toEqual(lines)
  })
})

describe("buildDialHref", () => {
  const base = {
    countryCode: "in",
    token: "tok_abc",
    lines: [
      { variant_id: "variant_a", quantity: 10 },
      { variant_id: "variant_b", quantity: 5 },
    ],
  }

  it("moves one line and carries every other one unchanged", () => {
    const href = buildDialHref({ ...base, variantId: "variant_a", quantity: 11 })
    expect(href).toBe(
      "/in/quotes/tok_abc?lines=variant_a%3A11%2Cvariant_b%3A5"
    )
    // The whole basket survives the hop, so a second dial does not silently
    // reset the first.
    expect(parseDialledLines(decodeURIComponent(href.split("lines=")[1]))).toEqual([
      { variant_id: "variant_a", quantity: 11 },
      { variant_id: "variant_b", quantity: 5 },
    ])
  })

  it("does not mutate the lines it was given", () => {
    buildDialHref({ ...base, variantId: "variant_a", quantity: 99 })
    expect(base.lines[0].quantity).toBe(10)
  })

  it("escapes the token, which is the credential and lives in the path", () => {
    expect(
      buildDialHref({ ...base, token: "a/b", variantId: "variant_a", quantity: 2 })
    ).toContain("/in/quotes/a%2Fb?")
  })
})

describe("buildQuotedHref", () => {
  it("drops the dial entirely, back to the basket the partner sent", () => {
    expect(buildQuotedHref({ countryCode: "in", token: "tok_abc" })).toBe(
      "/in/quotes/tok_abc"
    )
  })
})

/**
 * "Also made in" pills.
 *
 * The label is the only part of a sibling variant that is not already true of
 * the quoted one. Tested because the failure is silent in both directions: too
 * eager and the pill says nothing the buyer can act on, too shy and five
 * 45-character titles wrap to one per line and the difference is off the end of
 * each.
 */
describe("otherVariantLabel", () => {
  const QUOTED = "Pattern 1 - Blue/Mustard/Cream/Grey / HandSpun"

  it("keeps only the option that differs", () => {
    expect(
      otherVariantLabel(QUOTED, "Pattern 1 - Blue/Mustard/Cream/Grey / MilSpun")
    ).toBe("MilSpun")
  })

  it("keeps the pattern when that is what changed", () => {
    expect(
      otherVariantLabel(QUOTED, "Pattern 2 - Mustard/Dusty Blue/Grey / HandSpun")
    ).toBe("Pattern 2 - Mustard/Dusty Blue/Grey")
  })

  it("keeps both segments when both differ", () => {
    expect(
      otherVariantLabel(QUOTED, "Pattern 3 - Blue/Yellow/Grey/Cream / MilSpun")
    ).toBe("Pattern 3 - Blue/Yellow/Grey/Cream / MilSpun")
  })

  it("does not split on a slash inside one option value", () => {
    expect(otherVariantLabel("Red/Blue", "Green/Blue")).toBe("Green/Blue")
  })

  it("🔴 falls back to the whole title rather than rendering an empty pill", () => {
    // Same title, different variant: they differ on something this string does
    // not spell out. An empty pill would read as a rendering fault.
    expect(otherVariantLabel(QUOTED, QUOTED)).toBe(QUOTED)
  })

  it("survives a line with no variant title at all", () => {
    expect(otherVariantLabel(null, "HandSpun")).toBe("HandSpun")
    expect(otherVariantLabel(QUOTED, null)).toBe("Another finish")
    expect(otherVariantLabel(QUOTED, "   ")).toBe("Another finish")
  })
})
