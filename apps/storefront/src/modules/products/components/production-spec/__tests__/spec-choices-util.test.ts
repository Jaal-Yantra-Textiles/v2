import { describe, expect, it } from "vitest"

import type { StoreProductSpec } from "@lib/data/product-spec"
import {
  hasAnySpecChoice,
  initialSpecChoices,
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
  it("🔴 stays silent when the choices live on the SECOND STEP", () => {
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

    // 3 groups + colour = 4 > 2, so the page links out instead of asking.
    expect(unansweredRequiredGroups(overflowing, empty)).toHaveLength(0)
  })

  /** A single wide group overflows too — six values is the threshold. */
  it("stays silent when one required group is too wide for the column", () => {
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
    expect(unansweredRequiredGroups(wide, empty)).toHaveLength(0)
  })
})
