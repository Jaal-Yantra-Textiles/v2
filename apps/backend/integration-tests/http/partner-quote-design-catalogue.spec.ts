import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { createProductFromDesignWorkflow } from "../../src/workflows/designs/create-product-from-design"

jest.setTimeout(240 * 1000)

/**
 * A made-to-order design product, and whose catalogue it is in.
 *
 * ## The two defects this pins
 *
 * Quoting a design for a partner was impossible — not difficult, impossible —
 * and had been since the feature shipped. Readiness answered with two blocking
 * rows for every design, and both of them were wrong for the same underlying
 * reason: nothing on the write side knew who was being quoted for.
 *
 * 1. `create-product-from-design` read `listStores({})[0]` and used THAT
 *    store's default sales channel. On a platform with fifteen stores that is
 *    whichever row Postgres handed back first — in practice the core "Default
 *    Sales Channel", never the quoting partner's. All twelve custom-design
 *    products on production landed there, so `variant_not_in_catalogue` was
 *    unavoidable.
 *
 * 2. `unit_weight_grams` — the operator's own figure, which exists precisely
 *    because "a design quoted before its garment has ever been weighed has none
 *    by definition" — was sent by the wizard, accepted by the validator,
 *    declared on the input type, and read by NOTHING in the weight check. Three
 *    producers, zero consumers.
 *
 * ## Why this runs against a container
 *
 * Both are wiring. The pure halves (`isMadeToOrderDesignProduct`,
 * `resolveUnitWeight`) were always correct in isolation, and every unit test
 * over them passed throughout. What was broken is which arguments reached them,
 * which is only observable end to end.
 *
 * 🔑 The fixture deliberately mints the product the OLD way — no
 * `sales_channel_id` — so the starting state is the production one. The
 * precondition is asserted rather than assumed: if the fallback ever happened
 * to pick the partner's own store, every assertion below would pass while
 * testing nothing.
 */

setupSharedTestSuite(() => {
  describe("Quoting a made-to-order design (#1486 catalogue + weight)", () => {
    let seed: QuoteFixture
    let designId: string
    let designVariantId: string
    let designProductId: string

    const container = () => getSharedTestEnv().getContainer()

    const productOf = async (variantId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "variant",
        fields: [
          "id",
          "product.id",
          "product.metadata",
          "product.sales_channels.id",
        ],
        filters: { id: [variantId] },
      })
      return (data?.[0] as any)?.product
    }

    const readiness = async (lines: any[]) => {
      const { api } = getSharedTestEnv()
      const body = mintBody(seed, {})
      const res = await api.post(
        "/partners/quotes/readiness",
        {
          lines,
          destination_country_code: body.destination_country_code,
          destination_postal_code: body.destination_postal_code,
          currency_code: body.currency_code,
          carrier: body.carrier,
        },
        { headers: seed.headers }
      )
      return res.data.readiness
    }

    const codes = (r: any) => (r?.issues ?? []).map((i: any) => i.code)
    const severityOf = (r: any, code: string) =>
      (r?.issues ?? []).find((i: any) => i.code === code)?.severity ?? null

    beforeAll(async () => {
      await createAdminUser(container())
      seed = await setupQuoteFixture(getSharedTestEnv().api, () => container())

      const designs: any = container().resolve(DESIGN_MODULE)
      const created = await designs.createDesigns({
        name: `Oshen Scarves ${seed.unique}`,
        description: "A design with no product behind it yet.",
        owner_partner_id: seed.partnerId,
      })
      designId = (Array.isArray(created) ? created[0] : created).id

      /**
       * Minted WITHOUT a sales channel, on purpose — this is the production
       * shape, and the state every existing custom-design product is in.
       */
      const { result } = await createProductFromDesignWorkflow(
        container()
      ).run({
        input: {
          design_id: designId,
          estimated_cost: 900,
          unit_price: 900,
          currency_code: seed.currencyCode,
          made_to_order: true,
        } as any,
      })

      designVariantId = (result as any).variant_id
      designProductId = (result as any).product_id

      const product = await productOf(designVariantId)

      // 🔴 Precondition, asserted rather than assumed. A fixture that happened
      // to start in the partner's own channel would make every catalogue
      // assertion below vacuous while still going green.
      expect(product?.metadata?.is_custom_design).toBe(true)
      expect(
        (product?.sales_channels ?? []).map((c: any) => c.id)
      ).not.toContain(seed.salesChannelId)
    })

    it("🔴 a design line's catalogue miss is a WARNING, because the mint fixes it", async () => {
      const r = await readiness([
        { variant_id: designVariantId, design_id: designId, quantity: 5 },
      ])

      // Not the blocking row that made this unquotable.
      expect(codes(r)).not.toContain("variant_not_in_catalogue")
      expect(severityOf(r, "design_catalogue_pending")).toBe("warning")
    })

    it("🔴 the same product quoted as a plain variant is still REFUSED", async () => {
      // The boundary. Nothing attaches a catalogue link for a line that never
      // named a design, so a warning here would be a promise no code keeps —
      // and softening it for every custom-design product is exactly how a
      // tenancy guard stops guarding.
      const r = await readiness([{ variant_id: designVariantId, quantity: 5 }])

      expect(severityOf(r, "variant_not_in_catalogue")).toBe("blocking")
      expect(codes(r)).not.toContain("design_catalogue_pending")
    })

    it("🔴 a typed unit_weight_grams answers the weight the catalogue cannot", async () => {
      const without = await readiness([
        { variant_id: designVariantId, design_id: designId, quantity: 5 },
      ])
      // A made-to-order design has no weight at either level, by definition.
      expect(severityOf(without, "weight_missing")).toBe("blocking")

      const withWeight = await readiness([
        {
          variant_id: designVariantId,
          design_id: designId,
          quantity: 5,
          unit_weight_grams: 320,
        },
      ])

      // The figure the wizard has always sent, now actually read.
      expect(codes(withWeight)).not.toContain("weight_missing")
      // And the estimate it was meant to feed can finally run: `weight_missing`
      // gates `canEstimate`, so while it was raised the freight leg never even
      // executed.
      expect(withWeight.freight).toBeDefined()
    })

    it("minting puts the design's product in the quoting partner's catalogue", async () => {
      const { api } = getSharedTestEnv()

      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `design-cat-${seed.unique}@jaalyantra.test`,
          lines: [
            {
              variant_id: designVariantId,
              design_id: designId,
              quantity: 5,
              unit_weight_grams: 320,
            },
          ],
        }),
        { headers: seed.headers }
      )
        .catch((e: any) => e.response)

      // The message, not just the code — a bare 500 says nothing about which
      // of the four things this route now does went wrong.
      expect([res.status, String(res.data?.message ?? "")]).toEqual([201, ""])

      const product = await productOf(designVariantId)
      expect(product.id).toBe(designProductId)
      // Added, not replaced — the same design can be quoted by another partner
      // tomorrow, and a design belongs to nobody before a production run.
      const channelIds = (product.sales_channels ?? []).map((c: any) => c.id)
      expect(channelIds).toContain(seed.salesChannelId)
      expect(channelIds.length).toBeGreaterThan(1)

      /**
       * And the warning has answered itself — the loop closes.
       *
       * ⚠️ Asserted HERE rather than as a following test, and that is not a
       * style choice: the runner restores a database snapshot before every
       * test, so a second `it` would read the product as it was before this
       * mint and report the warning again. A test built that way fails for a
       * reason that has nothing to do with the code.
       */
      const after = await readiness([
        {
          variant_id: designVariantId,
          design_id: designId,
          quantity: 5,
          unit_weight_grams: 320,
        },
      ])

      expect(codes(after)).not.toContain("design_catalogue_pending")
      expect(codes(after)).not.toContain("variant_not_in_catalogue")
    })

    /**
     * The admin surface, which is where this was actually reported.
     *
     * 🔴 It has a gate the partner surface does not: `assertVariantsInStore`
     * throws a 400 for anything outside the named partner's channel, and it
     * runs on the MINT, after the preflight has already said the basket is
     * fine. So a readiness fix alone would have moved the refusal one step
     * later rather than removing it — the preflight would go green and the
     * mint would answer "these variants are not in X's catalogue". The order
     * of the two calls in the route is the whole point.
     */
    it("🔴 an admin can quote a design on a partner's behalf, past the store assertion", async () => {
      const { api } = getSharedTestEnv()
      const adminHeaders = await getAuthHeaders(api)
      const body = mintBody(seed, {})

      const pre = await api.post(
        "/admin/quotes/readiness",
        {
          partner_id: seed.partnerId,
          lines: [
            {
              variant_id: designVariantId,
              design_id: designId,
              quantity: 5,
              unit_weight_grams: 320,
            },
          ],
          destination_country_code: body.destination_country_code,
          destination_postal_code: body.destination_postal_code,
          currency_code: body.currency_code,
          carrier: body.carrier,
        },
        adminHeaders
      )

      const preCodes = (pre.data.readiness?.issues ?? []).map(
        (i: any) => i.code
      )
      expect(preCodes).not.toContain("variant_not_in_catalogue")
      expect(preCodes).not.toContain("weight_missing")

      const res = await api
        .post(
          "/admin/quotes",
          {
            ...body,
            partner_id: seed.partnerId,
            buyer_email: `admin-design-${seed.unique}@jaalyantra.test`,
            lines: [
              {
                variant_id: designVariantId,
                design_id: designId,
                quantity: 5,
                unit_weight_grams: 320,
              },
            ],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      // The message, because `assertVariantsInStore` refuses BY NAME and a
      // bare status would not say which of the two gates spoke.
      expect([res.status, String(res.data?.message ?? "")]).toEqual([201, ""])
    })
  })
})
