import {
  composeProducerTags,
  producerStorefrontUrl,
  resolveQuoteProducer,
  shouldNameProducer,
} from "../lib/quote-producer"

/**
 * "Who is producing this" (#1428).
 *
 * The assertion that matters is the one about NOT knowing. If "no publishable
 * key" or "partner has no sales channel" were ever read as "therefore a JYT
 * storefront", the band would name the partner on the partner's own site —
 * which is the exact noise the condition exists to avoid, and it would look
 * right in every happy-path test.
 */

const scopeWith = (partners: any[], opts: { throws?: boolean } = {}) => ({
  resolve: () => ({
    graph: async (args: any) => {
      if (opts.throws) throw new Error("query fell over")
      // Filtered by id, never a bare list — an unfiltered partner read on a
      // public unauthenticated route is #1397.
      expect(args.filters?.id).toBeDefined()
      return { data: partners }
    },
  }),
})

const PARTNER = {
  id: "part_1",
  name: "Unique Pashmina",
  handle: "unique-pashmina",
  logo: "https://cdn/logo.png",
  country_code: "IN",
  is_verified: true,
  status: "active",
  workspace_type: "manufacturer",
  custom_domain: "uniquepashmina.com",
  custom_domain_verified: true,
  storefront_domain: "unique-pashmina.jaalyantra.com",
  stores: [{ default_sales_channel_id: "sc_partner" }],
}

describe("shouldNameProducer", () => {
  it("names the producer when the viewer is on a DIFFERENT storefront", () => {
    expect(shouldNameProducer(["sc_jyt"], ["sc_partner"])).toBe(true)
  })

  it("stays quiet on the partner's own storefront", () => {
    expect(shouldNameProducer(["sc_partner"], ["sc_partner"])).toBe(false)
  })

  it("stays quiet when the key spans several channels, one of them the partner's", () => {
    expect(shouldNameProducer(["sc_jyt", "sc_partner"], ["sc_partner"])).toBe(false)
  })

  it("stays quiet when the viewer is unknown — absence is not 'somewhere else'", () => {
    expect(shouldNameProducer(null, ["sc_partner"])).toBe(false)
    expect(shouldNameProducer([], ["sc_partner"])).toBe(false)
  })

  it("stays quiet when the partner has no channel to compare against", () => {
    expect(shouldNameProducer(["sc_jyt"], [])).toBe(false)
    expect(shouldNameProducer(["sc_jyt"], null)).toBe(false)
  })

  it("ignores null channel ids rather than treating them as a match", () => {
    // 🔴 A dangling publishable key produces `sales_channels: [null]`. Two
    // nulls comparing equal would silence the band on every storefront.
    expect(shouldNameProducer([null as any], [null as any])).toBe(false)
  })
})

describe("resolveQuoteProducer", () => {
  it("returns the partner on a JYT storefront", async () => {
    const producer = await resolveQuoteProducer(scopeWith([PARTNER]) as any, {
      partner_id: "part_1",
      viewer_sales_channel_ids: ["sc_jyt"],
      product_tags: ["handloom", "Pashmina"],
    })

    expect(producer).toEqual({
      id: "part_1",
      name: "Unique Pashmina",
      handle: "unique-pashmina",
      logo: "https://cdn/logo.png",
      country_code: "IN",
      is_verified: true,
      url: "https://uniquepashmina.com",
      tags: ["Manufacturer", "Verified maker", "IN", "handloom", "Pashmina"],
      // 🔑 Null here, ALWAYS. The story lives on the product's artisan detail
      // and is attached by `buildQuoteView`, which holds the provenance. A
      // value resolved here would be a second answer to one question.
      story: null,
    })
  })

  it("returns null on the partner's own storefront", async () => {
    expect(
      await resolveQuoteProducer(scopeWith([PARTNER]) as any, {
        partner_id: "part_1",
        viewer_sales_channel_ids: ["sc_partner"],
      })
    ).toBeNull()
  })

  it("never queries at all without a viewer or a partner", async () => {
    const scope = { resolve: () => { throw new Error("must not resolve") } }

    expect(
      await resolveQuoteProducer(scope as any, {
        partner_id: "part_1",
        viewer_sales_channel_ids: null,
      })
    ).toBeNull()
    expect(
      await resolveQuoteProducer(scope as any, {
        partner_id: null,
        viewer_sales_channel_ids: ["sc_jyt"],
      })
    ).toBeNull()
  })

  it("does not present an inactive partner as a credential", async () => {
    expect(
      await resolveQuoteProducer(
        scopeWith([{ ...PARTNER, status: "inactive" }]) as any,
        { partner_id: "part_1", viewer_sales_channel_ids: ["sc_jyt"] }
      )
    ).toBeNull()
  })

  it("swallows a failed query — a credit line is not worth a buyer's 500", async () => {
    expect(
      await resolveQuoteProducer(scopeWith([], { throws: true }) as any, {
        partner_id: "part_1",
        viewer_sales_channel_ids: ["sc_jyt"],
      })
    ).toBeNull()
  })
})

describe("producerStorefrontUrl", () => {
  it("prefers a VERIFIED custom domain", () => {
    expect(producerStorefrontUrl(PARTNER)).toBe("https://uniquepashmina.com")
  })

  it("refuses to link an unverified custom domain", () => {
    // 🔴 `custom_domain` is whatever the partner typed into the connect form.
    // Until verification says the DNS is ours, linking it points a buyer at a
    // host we do not control.
    expect(
      producerStorefrontUrl({ ...PARTNER, custom_domain_verified: false })
    ).toBe("https://unique-pashmina.jaalyantra.com")
  })

  it("is null when the partner has no reachable domain at all", () => {
    expect(
      producerStorefrontUrl({ custom_domain: null, storefront_domain: null })
    ).toBeNull()
    expect(producerStorefrontUrl(undefined)).toBeNull()
  })

  it("does not double up a scheme already in the column", () => {
    expect(
      producerStorefrontUrl({ storefront_domain: "https://Already.com" })
    ).toBe("https://already.com")
  })
})

describe("composeProducerTags", () => {
  it("puts the workshop facts first, then the catalogue's words", () => {
    expect(
      composeProducerTags({
        workspace_type: "manufacturer",
        is_verified: true,
        country_code: "in",
        product_tags: ["handloom"],
      })
    ).toEqual(["Manufacturer", "Verified maker", "IN", "handloom"])
  })

  it("🔑 never claims verified when the partner is not", () => {
    // The one tag here that is a CLAIM rather than a description. An unverified
    // maker badged as verified is a lie told on our letterhead.
    expect(
      composeProducerTags({ workspace_type: "individual", is_verified: false })
    ).toEqual(["Individual"])
  })

  it("dedupes case-insensitively", () => {
    // "Handloom" and "handloom" as two chips reads as a data problem.
    expect(
      composeProducerTags({ product_tags: ["Handloom", "handloom", "  ", "Silk"] })
    ).toEqual(["Handloom", "Silk"])
  })

  it("returns an empty list, never a placeholder tag", () => {
    expect(composeProducerTags({})).toEqual([])
  })
})
