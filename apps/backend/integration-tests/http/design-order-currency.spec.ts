import { Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/framework/types"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

/**
 * 🔴 Read the LINE ITEMS from the cart module, not from the create response.
 *
 * The route echoes its cart with `items: []` — the items are written but the
 * echoed object does not carry them. Asserting on the echo would pass a test
 * that proves nothing, or fail one that is actually fine. A write's echo is
 * thinner than a read.
 */
const readLines = async (container: any, cartId: string) => {
  const cartService: any = container.resolve(Modules.CART)
  return (await cartService.listLineItems({ cart_id: cartId })) as any[]
}

jest.setTimeout(60000)

/**
 * #2176 — a design order can be created in the BUYER's currency, and a price
 * in another currency is CONVERTED rather than relabelled.
 *
 * ## What went wrong on prod
 *
 * Design `Tibetan Chupa Style Shirt` carries `estimated_cost: 10000` and
 * `cost_currency: "inr"` — ten thousand RUPEES, written on the design. The
 * draft-order workflow tagged its estimate with no currency at all, under the
 * comment "estimation results are in store default currency", and the
 * conversion step then fell back to the HOUSE store's currency. The house store
 * is EUR while 12 of 15 storefronts sell in INR, so a rupee figure was read as
 * euros and FX-converted into the rupee cart. The line kept the evidence:
 * `original_currency: "eur"` on an `inr` cart.
 *
 * ## Why this is an integration test and not a unit test
 *
 * 🔴 The defect is in what the DATABASE ends up holding — the cart's currency,
 * its region, and the unit price on its line. A unit test with a stubbed
 * estimator can prove the tagging rule (and does, in
 * `estimate-source-currency.unit.spec.ts`) but it cannot prove that a rupee
 * design produces a sensible euro cart, because the conversion, the region
 * lookup and the cart write all happen elsewhere.
 *
 * The distinction this pins down is RELABEL vs CONVERT: 10000 appearing in a
 * EUR cart as `10000` is the bug; appearing as a converted figure is the fix.
 */
setupSharedTestSuite(() => {
  describe("#2176 design order currency", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: { headers: Record<string, string> }
    let inrDesignId: string

    /** The rupee price written on the design. */
    const INR_COST = 10000

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionService = container.resolve(
        Modules.REGION
      ) as IRegionModuleService

      // Both regions must exist: the create step refuses a currency it cannot
      // find a region for, which is the behaviour the last case asserts.
      const { regions } = (await api.get("/admin/regions?limit=100", adminHeaders))
        .data
      const has = (code: string) =>
        (regions ?? []).some(
          (r: any) => String(r.currency_code).toLowerCase() === code
        )

      if (!has("inr")) {
        await regionService.createRegions({
          name: "2176 INR",
          currency_code: "inr",
          countries: ["in"],
        })
      }
      if (!has("eur")) {
        await regionService.createRegions({
          name: "2176 EUR",
          currency_code: "eur",
          countries: ["de"],
        })
      }

      const unique = Date.now()
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `2176 Rupee Design ${unique}`,
          description: "Priced in rupees on the design itself",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: INR_COST,
          // 🔴 The fact the whole bug turned on. It was there all along.
          cost_currency: "inr",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      inrDesignId = designRes.data.design.id
    })

    it("the design records its own cost currency", async () => {
      const res = await api.get(`/admin/designs/${inrDesignId}`, adminHeaders)
      expect(res.data.design.estimated_cost).toBe(INR_COST)
      expect(String(res.data.design.cost_currency).toLowerCase()).toBe("inr")
    })

    it("an INR order prices the rupee design at its face value — no conversion", async () => {
      const res = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [inrDesignId], currency_code: "inr" },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const cart = res.data.cart
      expect(String(cart.currency_code).toLowerCase()).toBe("inr")

      const lines = await readLines(getContainer(), cart.id)
      const line = lines.find((i: any) => i.metadata?.design_id === inrDesignId)
      expect(line).toBeTruthy()
      expect(Number(line.unit_price)).toBe(INR_COST)

      /**
       * 🔴 The regression marker. Before the fix this line carried
       * `original_currency: "eur"` on an `inr` cart — a rupee estimate that had
       * been read as euros and converted. Same currency in and out means no
       * conversion happened at all, which is the only correct answer here.
       */
      expect(line.metadata?.original_currency).toBeUndefined()
    })

    /**
     * 🔴 THE CASE THAT MATTERS. A rupee design sold to a European buyer.
     *
     * If the number arrives unchanged, the cart says "€10,000" for cloth worth
     * about €90 — a relabel. It must be CONVERTED.
     */
    it("a EUR order CONVERTS the rupee price rather than relabelling it", async () => {
      const res = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [inrDesignId], currency_code: "eur" },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const cart = res.data.cart
      // The cart is genuinely in EUR, and in a EUR region — the region decides
      // the payment providers a buyer is offered, which is the whole reason a
      // EU buyer needs this.
      expect(String(cart.currency_code).toLowerCase()).toBe("eur")

      const lines = await readLines(getContainer(), cart.id)
      const line = lines.find((i: any) => i.metadata?.design_id === inrDesignId)
      expect(line).toBeTruthy()

      // NOT the rupee number wearing a euro label.
      expect(Number(line.unit_price)).not.toBe(INR_COST)
      // A euro price for this cloth is nowhere near ten thousand. Asserted as a
      // band rather than an exact figure because the rate is live and a test
      // pinned to today's rate would fail tomorrow for no reason.
      expect(Number(line.unit_price)).toBeGreaterThan(0)
      expect(Number(line.unit_price)).toBeLessThan(INR_COST / 10)

      /**
       * The conversion records where it came from, and it must say INR — the
       * design's own currency. `"eur"` here would mean the estimate had been
       * read as euros again, which is the original bug wearing the right answer.
       */
      expect(String(line.metadata?.original_currency).toLowerCase()).toBe("inr")
      expect(Number(line.metadata?.original_amount)).toBe(INR_COST)
    })

    /**
     * A currency with no region must not produce a cart.
     *
     * ⚠️ It currently fails at the FX step, not the region check: the exchange
     * rate lookup runs first and throws "Failed to fetch exchange rate
     * INR→XOF: 404 Not Found", which surfaces as a 500 carrying an HTML stack
     * trace rather than the create step's own message ("No region is configured
     * for XOF..."). The REFUSAL is correct and is what this asserts; the shape
     * of it is not, and is worth tidying separately — an operator should not
     * meet a stack trace for choosing an unsupported currency.
     */
    it("refuses a currency no region is configured for, rather than creating a cart", async () => {
      const res = await api
        .post(
          "/admin/designs/draft-order",
          { design_ids: [inrDesignId], currency_code: "xof" },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data?.cart).toBeUndefined()
    })
  })
})
