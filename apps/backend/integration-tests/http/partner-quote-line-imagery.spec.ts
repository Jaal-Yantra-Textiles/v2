import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * What the buyer can SEE of the piece they are approving (#1439 S14).
 *
 * ## Two fields, two different failures
 *
 * `images` is the variant's whole gallery. The identity query has fetched every
 * image since #1428, but `pickLineImage` took the first and the rest were
 * silently discarded — a defect with no symptom, because one photo renders
 * perfectly well and nobody knows the other four exist. A test is the only
 * thing that can notice.
 *
 * `other_variants` answers "can I get this in indigo?" with a fact instead of a
 * round trip. 🔴 It is NOT a picker, and the assertions below pin that: the
 * quoted variant is excluded, because the quote is frozen against it at a
 * frozen price and offering the buyer a different one would be describing an
 * agreement that does not exist. The only action it implies is replying to the
 * partner.
 */
setupSharedTestSuite(() => {
  describe("GET /store/b2b/quotes/:token — what the buyer can see (#1439 S14)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>
    let quote: any

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }

      const mint = await api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `imagery-${seed.unique}@jaalyantra.test`,
        }),
        { headers: seed.headers }
      )
      const view = await api.get(`/store/b2b/quotes/${mint.data.token}`, {
        headers: storeHeaders,
      })
      quote = view.data.quote
    })

    const lineFor = (variantId: string) =>
      quote.lines.find((l: any) => l.variant_id === variantId)

    it("carries a gallery array on every line", () => {
      for (const line of quote.lines) {
        expect(Array.isArray(line.images)).toBe(true)
      }
    })

    it("keeps the gallery and the thumbnail telling the same story", () => {
      /**
       * The invariant that matters regardless of what the fixture uploads: if
       * the variant has images of its own, the thumbnail IS the first of them
       * and `image_source` says so. A gallery whose first frame differed from
       * the thumbnail would show the buyer one crop in the table and open on a
       * different one.
       */
      for (const line of quote.lines) {
        if (line.images.length) {
          expect(line.thumbnail).toBe(line.images[0])
          expect(line.image_source).toBe("variant")
        } else if (line.thumbnail) {
          // Degraded to the product's photo — a weaker claim, and labelled one.
          expect(line.image_source).toBe("product")
        }
      }
    })

    it("🔴 leaves the gallery empty rather than borrowing the product's photo", () => {
      /**
       * Mixing a product-level photo into a variant's gallery would pass a
       * weaker claim off as one of this colourway's own shots — the whole
       * reason `image_source` exists. So `[]` means "no gallery", never "one
       * borrowed picture", and a line that fell back to the product thumbnail
       * must have nothing in `images` at all.
       *
       * The fixture's variants carry no images of their own, so this is the
       * branch it actually exercises.
       */
      for (const line of quote.lines) {
        if (line.image_source === "product") {
          expect(line.images).toEqual([])
        }
      }
      // And the fallback really is the branch under test here — if the fixture
      // ever gains variant images this asserts nothing, so say so loudly.
      expect(quote.lines.some((l: any) => l.image_source !== "variant")).toBe(true)
    })

    it("names the product's other weaves, and excludes the quoted one", () => {
      // The fixture is one product with two variants — Twill and Diamond — so
      // each line's sibling list is exactly the other.
      const twill = lineFor(seed.variantA.id)
      const diamond = lineFor(seed.variantB.id)

      expect(twill.other_variants.map((v: any) => v.id)).toEqual([
        seed.variantB.id,
      ])
      expect(diamond.other_variants.map((v: any) => v.id)).toEqual([
        seed.variantA.id,
      ])

      // 🔴 The quoted variant must never appear in its own sibling list: the
      // price is frozen against it, and listing it beside the alternatives
      // reads as a choice the buyer still has.
      for (const line of quote.lines) {
        expect(line.other_variants.map((v: any) => v.id)).not.toContain(
          line.variant_id
        )
      }
    })

    it("carries a title for each sibling, so a badge never renders an id", () => {
      const titles = lineFor(seed.variantA.id).other_variants.map(
        (v: any) => v.title
      )
      expect(titles).toEqual(["Diamond"])
    })
  })
})
