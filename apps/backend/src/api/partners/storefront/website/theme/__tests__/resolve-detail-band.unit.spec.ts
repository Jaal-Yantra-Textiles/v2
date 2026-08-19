import { resolveDetailBand } from "../resolve-detail-band"
import { detailBandSchema } from "../detail-band"

/**
 * #1364 — the product detail band.
 *
 * The band lists blocks for EVERY product, but each product answers for itself.
 * These cases pin the two halves of that: the arrangement comes from the theme,
 * and a block whose product has nothing to show does not render a heading over
 * a blank.
 */
const band = (over: any = {}) =>
  ({
    enabled: true,
    layout: "grid-2",
    blocks: [
      { source: "spec" },
      { source: "maker" },
      { source: "care", body: "Dry clean only." },
    ],
    ...over,
  }) as any

describe("resolveDetailBand", () => {
  it("keeps only the blocks this product can actually fill", () => {
    const resolved = resolveDetailBand(band(), { spec: true, maker: false })
    expect(resolved?.blocks.map((b) => b.source)).toEqual(["spec", "care"])
  })

  it("uses the theme's layout and the source's default label", () => {
    const resolved = resolveDetailBand(band(), { spec: true })
    expect(resolved?.layout).toBe("grid-2")
    expect(resolved?.blocks[0].label).toBe("Made to")
  })

  it("lets the partner rename a block without changing where it reads from", () => {
    const resolved = resolveDetailBand(
      band({ blocks: [{ source: "spec", label: "How it's woven" }] }),
      { spec: true }
    )
    expect(resolved?.blocks[0]).toEqual({
      source: "spec",
      label: "How it's woven",
    })
  })

  /**
   * The whole reason this function exists. A theme that lists spec + maker +
   * care would otherwise render three headings over three blanks on a product
   * that has none of them — advertising detail nobody wrote.
   */
  it("drops the band entirely when nothing survives", () => {
    expect(
      resolveDetailBand(band({ blocks: [{ source: "spec" }] }), { spec: false })
    ).toBeNull()
  })

  it("drops a theme-authored block with no copy — there is no product to fall back to", () => {
    expect(
      resolveDetailBand(band({ blocks: [{ source: "care", body: "   " }] }), {})
    ).toBeNull()
  })

  it("keeps a disabled block out without making the partner delete it", () => {
    const resolved = resolveDetailBand(
      band({
        blocks: [
          { source: "spec", enabled: false },
          { source: "care", body: "Dry clean only." },
        ],
      }),
      { spec: true }
    )
    expect(resolved?.blocks.map((b) => b.source)).toEqual(["care"])
  })

  /**
   * THE CONTROL THAT MUST NOT FIRE. Every theme that predates the band has no
   * `detail_band` key, and those product pages must render exactly as before.
   */
  it.each([undefined, null, {}, { enabled: false }])(
    "renders nothing for %p",
    (value) => {
      expect(resolveDetailBand(value as any, { spec: true, maker: true })).toBeNull()
    }
  )

  it("defaults to rows — a lone block in a 2-up grid is a half-width card beside dead space", () => {
    const resolved = resolveDetailBand(
      { enabled: true, blocks: [{ source: "spec" }] } as any,
      { spec: true }
    )
    expect(resolved?.layout).toBe("rows")
  })

  it("ignores a body written on a per-product source — a theme cannot state a fact about a piece", () => {
    const resolved = resolveDetailBand(
      band({ blocks: [{ source: "spec", body: "invented" }] }),
      { spec: true }
    )
    expect(resolved?.blocks[0].body).toBeUndefined()
  })
})

describe("the schema the partner and the assistant write through", () => {
  it("accepts every layout the resolver can return", () => {
    for (const layout of ["grid-2", "grid-3", "rows", "tabs", "accordion"]) {
      expect(detailBandSchema.safeParse({ enabled: true, layout }).success).toBe(
        true
      )
    }
  })

  it("rejects a block with no source — there would be nothing to read", () => {
    expect(
      detailBandSchema.safeParse({ blocks: [{ label: "Care" }] }).success
    ).toBe(false)
  })

  it("rejects an invented source rather than silently rendering nothing", () => {
    expect(
      detailBandSchema.safeParse({ blocks: [{ source: "reviews" }] }).success
    ).toBe(false)
  })

  it("caps the band at 8 blocks", () => {
    const nine = Array.from({ length: 9 }, () => ({ source: "spec" }))
    expect(detailBandSchema.safeParse({ blocks: nine }).success).toBe(false)
  })
})
