import { describe, expect, it } from "vitest"

import type { StoreProductSpec } from "@lib/data/product-spec"
import {
  hasAnySpecChoice,
  initialSpecChoices,
  unansweredRequired,
  unansweredRequiredGroups,
} from "../spec-choices-util"

/**
 * #1970 — who decides a required choice, us or the customer.
 *
 * This file had NO tests, and it is the file that decides whether a customer's
 * answer reaches the cart. The first run of
 * `e2e/specs/storefront-design-made-to-spec.spec.ts` is what surfaced it: a
 * design's size was preselected for the customer, and then discounted as "our
 * prefill" — so choosing L produced an ordinary cart line with no size on it,
 * and a garment would have gone to production with nobody knowing what to make.
 */

const spec = (over: Partial<StoreProductSpec> = {}): StoreProductSpec =>
  ({
    accepting_custom_orders: true,
    colors: [],
    fields: [],
    finishes: [],
    options: [],
    ...over,
  }) as StoreProductSpec

/** A design's only axis: one required group, four sizes. */
const sizeSpec = () =>
  spec({
    options: [
      {
        key: "size",
        label: "Size",
        required: true,
        values: [{ label: "S" }, { label: "M" }, { label: "L" }, { label: "XL" }],
      },
    ],
  } as any)

const empty = { color: null, options: {}, note: "" }

describe("initialSpecChoices", () => {
  /** 🔴 The page must not answer on the customer's behalf. */
  it("preselects NOTHING, required groups included", () => {
    expect(initialSpecChoices(sizeSpec())).toEqual(empty)
  })

  it("still preselects nothing for optional groups or colour", () => {
    const s = spec({
      colors: [{ name: "Indigo" }],
      options: [
        { key: "border", label: "Border", required: false, values: [{ label: "Plain" }] },
      ],
    } as any)
    expect(initialSpecChoices(s)).toEqual(empty)
  })
})

describe("hasAnySpecChoice", () => {
  /**
   * 🔴 The defect, stated. This used to be `false`: required groups were
   * excluded, so the size the customer picked never made the line
   * made-to-order and was dropped on the floor.
   */
  it("counts a REQUIRED group the customer answered", () => {
    expect(
      hasAnySpecChoice(sizeSpec(), { color: null, options: { size: "L" }, note: "" })
    ).toBe(true)
  })

  it("is false while the question is still open", () => {
    expect(hasAnySpecChoice(sizeSpec(), empty)).toBe(false)
  })

  it("stays false when the partner is not accepting custom orders", () => {
    const closed = spec({ ...sizeSpec(), accepting_custom_orders: false } as any)
    expect(
      hasAnySpecChoice(closed, { color: null, options: { size: "L" }, note: "" })
    ).toBe(false)
  })

  it("still counts colour and a typed note", () => {
    expect(hasAnySpecChoice(spec(), { ...empty, color: "Indigo" })).toBe(true)
    expect(hasAnySpecChoice(spec(), { ...empty, note: "narrow border" })).toBe(true)
  })
})

describe("unansweredRequiredGroups", () => {
  /** Without this the prefill's removal just moves the silent failure. */
  it("holds the sale while a required group is unanswered", () => {
    expect(unansweredRequiredGroups(sizeSpec(), empty).map((g) => g.key)).toEqual([
      "size",
    ])
  })

  it("releases it once the customer answers", () => {
    expect(
      unansweredRequiredGroups(sizeSpec(), {
        color: null,
        options: { size: "L" },
        note: "",
      })
    ).toHaveLength(0)
  })

  /**
   * A required group with nothing orderable in it is the PARTNER's problem and
   * `blockedGroups` already reports it. Counting it here too would refuse the
   * click twice and name the wrong cause.
   */
  it("ignores a required group with no orderable values", () => {
    const s = spec({
      options: [{ key: "size", label: "Size", required: true, values: [] }],
    } as any)
    expect(unansweredRequiredGroups(s, empty)).toHaveLength(0)
  })

  it("ignores optional groups entirely", () => {
    const s = spec({
      options: [
        { key: "border", label: "Border", required: false, values: [{ label: "Plain" }] },
      ],
    } as any)
    expect(unansweredRequiredGroups(s, empty)).toHaveLength(0)
  })

  it("says nothing when the partner is not accepting custom orders", () => {
    const closed = spec({ ...sizeSpec(), accepting_custom_orders: false } as any)
    expect(unansweredRequiredGroups(closed, empty)).toHaveLength(0)
  })

  /**
   * 🔴 The regression this nearly shipped.
   *
   * Past two groups the choices are NOT on the product page — it shows a
   * summary and a "Customise this piece →" link, and its buy button is the
   * BUY-IT-AS-IS path. Holding that button would strand the customer behind a
   * question the page never asks.
   *
   * Modelled on a real live product, `prod_01KMHTK1T1BQ7KWKYWY1NR5RYZ`: a
   * handwoven muslin with 1 colour + 7 option groups, two of them required
   * (dyeing method, dye colour). Found by sweeping production for the blast
   * radius of this very change.
   */
  it("🔴 still REPORTS on a second-step spec — the customise page asks", () => {
    const overflowing = spec({
      colors: [{ name: "Natural White" }],
      options: [
        {
          key: "dyeing_method",
          label: "Dyeing Method",
          required: true,
          values: [{ label: "Indigo" }, { label: "Vat dyed" }],
        },
        {
          key: "dye_color",
          label: "Dye Color",
          required: true,
          values: [{ label: "Natural White" }, { label: "Black" }],
        },
        {
          key: "embroidery",
          label: "Embroidery",
          required: false,
          values: [{ label: "None" }],
        },
      ],
    } as any)

    /*
     * 3 groups + colour = 4 > 2, so the PRODUCT page links out instead of
     * asking — it drops these itself via `!secondStep`. The helper must still
     * report them, because `/products/:handle/customise` renders exactly these
     * questions and has to hold its own button. Folding `needsSecondStep` in
     * here silenced that page and left its button inviting a click whose only
     * outcome was the backend's "Choose Dye Color. Available: …".
     */
    expect(
      unansweredRequiredGroups(overflowing, empty).map((g) => g.key)
    ).toEqual(["dyeing_method", "dye_color"])
  })

  /** Same for one over-wide group: reported here, dropped by the product page. */
  it("still reports a required group too wide for the buying column", () => {
    const wide = spec({
      options: [
        {
          key: "dye_color",
          label: "Dye Color",
          required: true,
          values: Array.from({ length: 8 }, (_, i) => ({ label: `C${i}` })),
        },
      ],
    } as any)
    expect(unansweredRequiredGroups(wide, empty)).toHaveLength(1)
  })
})

/**
 * 🔴 Colour — the required question the gate could not see (#1970).
 *
 * `unansweredRequiredGroups` filters `spec.options`. The palette lives in
 * `spec.colors`, a different field, and nothing looked at it. That was harmless
 * only while colour was preselected; #1970 removed every prefill, and from that
 * moment all four live handloom fabrics had an "Add to cart" that was enabled,
 * said "Add to cart", and could only ever produce the backend's
 * `Choose a colour. Available colours: Natural White.`
 *
 * Found by clicking the real /customise page of a real product
 * (`e2e/specs/storefront-live-required-choices.spec.ts`) — never by reading it.
 */
describe("unansweredRequired — colour", () => {
  const palette = () =>
    spec({
      colors: [{ name: "Natural White" }],
      options: [
        {
          key: "dyeing_method",
          label: "Dyeing Method",
          required: true,
          values: [{ label: "Indigo" }],
        },
      ],
    } as any)

  it("🔴 reports the colour when a palette exists and none is chosen", () => {
    expect(
      unansweredRequired(palette(), empty, { madeToSpec: true }).map(
        (g) => g.label
      )
    ).toEqual(["Colour", "Dyeing Method"])
  })

  it("stops reporting it once the customer picks one", () => {
    const answered = { ...empty, color: "Natural White" }
    expect(
      unansweredRequired(palette(), answered, { madeToSpec: true }).map(
        (g) => g.label
      )
    ).toEqual(["Dyeing Method"])
  })

  it("says nothing about colour on a spec with no palette", () => {
    expect(
      unansweredRequired(sizeSpec(), empty, { madeToSpec: true }).map(
        (g) => g.key
      )
    ).toEqual(["size"])
  })

  /**
   * 🔴 The #2078 shape, one field over.
   *
   * An ordinary add-to-cart does not go through `/made-to-spec`, so the backend
   * never asks for a colour and the button must not either. Inferring
   * `madeToSpec` inside the helper instead of taking it from the caller is how
   * a gate ends up right on one page and a dead end on the page beside it.
   */
  it("🔴 holds nothing when the submission is NOT made-to-spec", () => {
    expect(unansweredRequired(palette(), empty, { madeToSpec: false })).toEqual([
      ...unansweredRequiredGroups(palette(), empty),
    ])
    expect(
      unansweredRequired(palette(), empty, { madeToSpec: false }).map(
        (g) => g.key
      )
    ).not.toContain("__colour")
  })

  it("holds nothing at all once the partner stops taking custom orders", () => {
    const off = spec({
      accepting_custom_orders: false,
      colors: [{ name: "Natural White" }],
    } as any)
    expect(unansweredRequired(off, empty, { madeToSpec: true })).toEqual([])
  })

  /**
   * ⚠️ The over-block trap. `spec.colors` arrives already filtered by the store
   * read route, which drops `available === false` so every storefront agrees on
   * what is orderable. A palette that filtered AGAIN here would gate a question
   * `made-to-spec/lib.ts` is not asking, and strand a partner whose only colour
   * is switched off.
   */
  it("treats an empty palette as no colour question", () => {
    const noneOrderable = spec({ colors: [], options: [] } as any)
    expect(
      unansweredRequired(noneOrderable, empty, { madeToSpec: true })
    ).toEqual([])
  })
})
