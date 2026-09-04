import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"
import {
  setupQuoteFixture,
  type QuoteFixture,
  VARIANT_A_TIER_PRICE,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * A negotiated price typed into a DRAFT reaches the minted quote (#1806).
 *
 * ## Why this could not be caught by the unit suites
 *
 * Every layer was individually fine. The grid bound a "Unit price" cell, the
 * draft validator accepted `override_unit_amount`, and `mintQuoteWorkflow` had
 * frozen per-line overrides correctly since #1439 S7 — with its own container
 * suite proving it. What nobody owned was the JOURNEY: the save built a line
 * without the number, the PATCH wrote five columns, and the mint body named
 * five fields. Three silent drops in a row, each in a file whose own tests
 * passed.
 *
 * So the assertions here are deliberately end-to-end and about a NUMBER, never
 * about a 200: type a trade price, save it, read the row back, mint, and check
 * what the buyer was actually quoted. "Items saved." is not evidence.
 */

const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
    throw e
  }
}

setupSharedTestSuite(() => {
  describe("the draft rail carries a per-line trade price (#1806)", () => {
    let seed: QuoteFixture
    let adminHeaders: any

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      seed = await setupQuoteFixture(api, getContainer)
    })

    const readLines = async (quoteId: string) => {
      const container = getSharedTestEnv().getContainer()
      const service: any = container.resolve(PARTNER_QUOTE_MODULE)
      return await service.listPartnerQuoteLines({ quote_id: quoteId })
    }

    const startDraft = async (label: string) => {
      const { api } = getSharedTestEnv()
      const res = await loud(label, () =>
        api.post(
          "/admin/quotes/drafts",
          {
            partner_id: seed.partnerId,
            destination_country_code: "in",
            destination_postal_code: "400001",
            destination_city: "Mumbai",
            currency_code: seed.currencyCode,
            region_id: seed.regionId,
            buyer_email: `buyer-${label}-${seed.unique}@jaalyantra.test`,
          },
          adminHeaders
        )
      )
      return res.data.draft.id as string
    }

    /**
     * 🔑 The assertion the issue asked for: re-read the row, do not trust the
     * toast. A save that persists nothing and a save that persists everything
     * return the same 200.
     */
    it("persists a flat unit price on the draft line", async () => {
      const { api } = getSharedTestEnv()
      const draftId = await startDraft("flat")

      await loud("patch-flat", () =>
        api.patch(
          `/admin/quotes/drafts/${draftId}`,
          {
            lines: [
              {
                variant_id: seed.variantA.id,
                quantity: 25,
                override_unit_amount: 19000,
              },
            ],
          },
          adminHeaders
        )
      )

      const [line] = await readLines(draftId)
      expect(line.override_kind).toBe("override_unit_amount")
      expect(Number(line.override_input_amount)).toBe(19000)
      /**
       * 🔑 And the product the variant belongs to, which the browser does not
       * send. The items modal rebuilds its product selection from this column,
       * and the grid renders a row per variant of the SELECTED products — saved
       * null, a reopened draft shows an empty grid over a full basket, with no
       * row to type a price onto.
       */
      expect(line.product_id).toBe(seed.productId)
    })

    it("persists a discount and an operator-typed weight", async () => {
      const { api } = getSharedTestEnv()
      const draftId = await startDraft("pct")

      await loud("patch-pct", () =>
        api.patch(
          `/admin/quotes/drafts/${draftId}`,
          {
            lines: [
              {
                variant_id: seed.variantA.id,
                quantity: 25,
                discount_percent: 20,
                unit_weight_grams: 415,
              },
            ],
          },
          adminHeaders
        )
      )

      const [line] = await readLines(draftId)
      expect(line.override_kind).toBe("discount_percent")
      expect(Number(line.override_input_amount)).toBe(20)
      expect(Number(line.quoted_unit_weight_grams)).toBe(415)
      // The provenance travels with the number, at the moment it is typed.
      expect(line.quoted_weight_source).toBe("manual")
    })

    /**
     * 🔴 The whole point. Before this, the draft minted at catalogue no matter
     * what had been typed — so the assertion is on the FROZEN unit amount of
     * the quote the buyer receives, not on anything the draft says.
     */
    it("mints at the negotiated price, not at catalogue", async () => {
      const { api } = getSharedTestEnv()
      const draftId = await startDraft("mint")

      await loud("patch-mint", () =>
        api.patch(
          `/admin/quotes/drafts/${draftId}`,
          {
            lines: [
              { variant_id: seed.variantA.id, quantity: 25, discount_percent: 20 },
            ],
          },
          adminHeaders
        )
      )

      const res = await loud("mint", () =>
        api.post(`/admin/quotes/drafts/${draftId}/mint`, {}, adminHeaders)
      )

      const quoteId = res.data.quote.id
      const lines = await readLines(quoteId)

      const expected = Math.round(VARIANT_A_TIER_PRICE * 0.8 * 100) / 100
      expect(Number(lines[0].quoted_unit_amount)).toBe(expected)
      expect(lines[0].override_kind).toBe("discount_percent")
      expect(Number(lines[0].override_input_amount)).toBe(20)
      // And the catalogue price is NOT what was quoted — the assertion that
      // fails on the old code.
      expect(Number(lines[0].quoted_unit_amount)).not.toBe(VARIANT_A_TIER_PRICE)
    })

    /**
     * "Which one wins" must not have an answer, and the refusal belongs where
     * the number is stored rather than minutes later at the mint.
     */
    it("refuses a line carrying both a discount and a flat price", async () => {
      const { api } = getSharedTestEnv()
      const draftId = await startDraft("both")

      await expect(
        api.patch(
          `/admin/quotes/drafts/${draftId}`,
          {
            lines: [
              {
                variant_id: seed.variantA.id,
                quantity: 25,
                discount_percent: 20,
                override_unit_amount: 19000,
              },
            ],
          },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
