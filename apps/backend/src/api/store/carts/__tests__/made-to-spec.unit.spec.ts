import {
  buildMadeToSpecSnapshot,
  MADE_TO_SPEC_METADATA_KEY,
  type ProductSpecRecord,
} from "../[id]/made-to-spec/lib"

/**
 * #1349 — what a customer is allowed to order, and what the order remembers.
 *
 * These assert the two rules the storefront cannot be trusted with: the palette
 * is closed, and the selection is copied rather than referenced.
 */

const NOW = new Date("2026-08-18T12:00:00.000Z")

const spec = (over: Partial<NonNullable<ProductSpecRecord>> = {}) =>
  ({
    id: "pspec_1",
    weave_technique: "pashmina",
    weave_label: "Kani, 3-colour",
    accepting_custom_orders: true,
    custom_order_lead_time_days: 45,
    colors: [
      { id: "c1", name: "Kashmiri walnut", hex_code: "#5B4636" },
      { id: "c2", name: "Saffron", hex_code: "#F4C430" },
      { id: "c3", name: "Retired indigo", hex_code: "#33468C", available: false },
    ],
    fields: [{ key: "pallu_type", label: "Pallu type", value: "Woven, 18in" }],
    ...over,
  }) as NonNullable<ProductSpecRecord>

describe("made-to-spec selection", () => {
  it("accepts a colour the partner published", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec(),
      selection: { color: "Saffron" },
      now: NOW,
    })

    expect(snapshot.color_name).toBe("Saffron")
    expect(snapshot.color_hex).toBe("#F4C430")
  })

  it("matches the colour case- and whitespace-insensitively", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec(),
      selection: { color: "  saffron " },
      now: NOW,
    })

    // The stored name is the PARTNER's spelling, not the customer's — the
    // order should read the way the partner wrote it.
    expect(snapshot.color_name).toBe("Saffron")
  })

  it("rejects a colour that is not in the palette, and says what is", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: spec(),
        selection: { color: "Neon pink" },
        now: NOW,
      })
    ).toThrow(/Kashmiri walnut, Saffron/)
  })

  it("rejects a colour the partner marked unavailable", () => {
    // The colour exists in the palette — it is simply not orderable. A check
    // that only asked "is this name known?" would let this through.
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: spec(),
        selection: { color: "Retired indigo" },
        now: NOW,
      })
    ).toThrow(/not available/)
  })

  it("refuses when the partner is not taking custom orders", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: spec({ accepting_custom_orders: false }),
        selection: { color: "Saffron" },
        now: NOW,
      })
    ).toThrow(/not currently accepting/)
  })

  it("refuses when the product has no spec at all", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: null,
        selection: { color: "Saffron" },
        now: NOW,
      })
    ).toThrow(/no production spec/)
  })

  it("requires a colour when the palette offers any", () => {
    expect(() =>
      buildMadeToSpecSnapshot({ spec: spec(), selection: {}, now: NOW })
    ).toThrow(/Choose a colour/)
  })

  it("allows an order with no colour when the palette is empty", () => {
    // A partner may take made-to-order work without publishing a palette —
    // the weave itself is the spec. Demanding a colour would block them.
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec({ colors: [] }),
      selection: { note: "For a September wedding" },
      now: NOW,
    })

    expect(snapshot.color_name).toBeUndefined()
    expect(snapshot.note).toBe("For a September wedding")
  })

  it("treats a palette of only-unavailable colours as offering nothing", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: spec({
          colors: [{ id: "c1", name: "Sold out", available: false }],
        }),
        selection: { color: "Sold out" },
        now: NOW,
      })
    ).toThrow(/no colours are currently listed/)
  })

  it("snapshots the lead time and weave rather than referencing the spec", () => {
    // A spec is edited; an order is a record. If the line item held only an id,
    // a partner changing the lead time next week would rewrite what a customer
    // was promised last week.
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec(),
      selection: { color: "Saffron" },
      now: NOW,
    })

    expect(snapshot).toMatchObject({
      spec_id: "pspec_1",
      weave: "Kani, 3-colour",
      lead_time_days: 45,
      captured_at: "2026-08-18T12:00:00.000Z",
      spec_fields: [{ label: "Pallu type", value: "Woven, 18in" }],
    })
  })

  it("falls back to the technique slug when the partner named nothing", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec({ weave_label: "   " }),
      selection: { color: "Saffron" },
      now: NOW,
    })

    expect(snapshot.weave).toBe("pashmina")
  })

  it("drops spec fields that carry no value", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: spec({
        fields: [
          { key: "pallu_type", label: "Pallu type", value: "  " },
          { key: "border", label: "Border", value: "Zari" },
        ],
      }),
      selection: { color: "Saffron" },
      now: NOW,
    })

    expect(snapshot.spec_fields).toEqual([{ label: "Border", value: "Zari" }])
  })

  it("rejects an oversized note", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: spec(),
        selection: { color: "Saffron", note: "x".repeat(501) },
        now: NOW,
      })
    ).toThrow(/under 500 characters/)
  })

  it("namespaces the metadata key so it cannot collide", () => {
    expect(MADE_TO_SPEC_METADATA_KEY).toBe("made_to_spec")
  })
})

/**
 * Partner-defined option groups — the axis a spec grew when "Color Pattern"
 * came off the variant matrix and "Embroidery" had nowhere to live.
 *
 * Same two rules as the palette, one level more general: the set is closed, and
 * what the customer picked is COPIED onto the line item. The cases below are
 * the ones a storefront gets wrong on its own.
 */
const withOptions = (over: Partial<NonNullable<ProductSpecRecord>> = {}) =>
  spec({
    colors: [],
    options: [
      {
        key: "color_pattern",
        label: "Color Pattern",
        required: true,
        order: 0,
        values: [
          { label: "Pattern 1 - Blue/Mustard/Cream/Grey", order: 0 },
          { label: "Pattern 2 - Mustard/Dusty Blue/Grey", order: 1 },
          { label: "Pattern 3 - Blue/Yellow/Grey/Cream", order: 2, available: false },
        ],
      },
      {
        key: "embroidery",
        label: "Embroidery",
        required: false,
        order: 1,
        values: [
          { label: "None", order: 0 },
          { label: "Kashida — cuff and pallu", note: "adds about two weeks", order: 1 },
        ],
      },
    ],
    ...over,
  })

describe("made-to-spec option groups", () => {
  it("records the chosen value, its group label and its note", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: withOptions(),
      selection: {
        options: {
          color_pattern: "Pattern 1 - Blue/Mustard/Cream/Grey",
          embroidery: "Kashida — cuff and pallu",
        },
      },
      now: NOW,
    })

    expect(snapshot.options).toEqual([
      {
        key: "color_pattern",
        label: "Color Pattern",
        value: "Pattern 1 - Blue/Mustard/Cream/Grey",
      },
      {
        key: "embroidery",
        label: "Embroidery",
        value: "Kashida — cuff and pallu",
        note: "adds about two weeks",
      },
    ])
  })

  it("rejects a value the partner switched off, naming what IS available", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: withOptions(),
        selection: {
          options: { color_pattern: "Pattern 3 - Blue/Yellow/Grey/Cream" },
        },
        now: NOW,
      })
    ).toThrow(/not available for Color Pattern.*Pattern 1.*Pattern 2/s)
  })

  it("rejects an unknown option key rather than ignoring it", () => {
    // A stale storefront sending a group the partner has dropped must not have
    // its choice silently discarded — that records an order nobody placed.
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: withOptions(),
        selection: {
          options: {
            color_pattern: "Pattern 1 - Blue/Mustard/Cream/Grey",
            tassel: "Knotted",
          },
        },
        now: NOW,
      })
    ).toThrow(/"tassel" is not an option/)
  })

  it("requires a required group and names the choices", () => {
    expect(() =>
      buildMadeToSpecSnapshot({
        spec: withOptions(),
        selection: { options: { embroidery: "None" } },
        now: NOW,
      })
    ).toThrow(/Choose Color Pattern.*Pattern 1.*Pattern 2/s)
  })

  it("leaves an optional group out when it was not chosen", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: withOptions(),
      selection: {
        options: { color_pattern: "Pattern 2 - Mustard/Dusty Blue/Grey" },
      },
      now: NOW,
    })

    expect(snapshot.options).toHaveLength(1)
    expect(snapshot.options?.[0].key).toBe("color_pattern")
  })

  it("refuses the order when a REQUIRED group has nothing available", () => {
    // The dangerous alternative is skipping it: the piece would be ordered
    // without an axis it cannot be woven without, and the partner would find
    // out at the loom.
    const dead = withOptions({
      options: [
        {
          key: "color_pattern",
          label: "Color Pattern",
          required: true,
          values: [{ label: "Pattern 1", available: false }],
        },
      ],
    })

    expect(() =>
      buildMadeToSpecSnapshot({ spec: dead, selection: {}, now: NOW })
    ).toThrow(/Color Pattern is required.*none of its choices are available/s)
  })

  it("skips an OPTIONAL group that has nothing available", () => {
    const quiet = withOptions({
      options: [
        {
          key: "embroidery",
          label: "Embroidery",
          required: false,
          values: [{ label: "Kashida", available: false }],
        },
      ],
    })

    const snapshot = buildMadeToSpecSnapshot({
      spec: quiet,
      selection: {},
      now: NOW,
    })

    expect(snapshot.options).toBeUndefined()
  })

  it("matches the value case-insensitively but stores the partner's casing", () => {
    const snapshot = buildMadeToSpecSnapshot({
      spec: withOptions(),
      selection: {
        options: { color_pattern: "pattern 1 - blue/mustard/cream/grey" },
      },
      now: NOW,
    })

    expect(snapshot.options?.[0].value).toBe(
      "Pattern 1 - Blue/Mustard/Cream/Grey"
    )
  })
})
