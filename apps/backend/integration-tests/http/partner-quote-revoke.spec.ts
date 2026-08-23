import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"

jest.setTimeout(240 * 1000)

/**
 * Revoking a quote (#1389 S5) — through the real route.
 *
 * ## Why this file exists
 *
 * `POST /admin/quotes/:id/revoke` returned **500 on every call**, on prod,
 * while doing its entire job correctly: the price list was deleted, the status
 * was written, and only then did the handler throw.
 *
 * ```ts
 * const [updated] = await service.updatePartnerQuotes({ id, status: "revoked" })
 * //    ^^^^^^^^^ TypeError: (intermediate value) is not iterable
 * ```
 *
 * `updateX` returns whatever the inner service returns: the `{ selector, data }`
 * bulk form yields an ARRAY, the bare entity form used here yields a SINGLE
 * OBJECT. Four sibling call sites in this repo destructure the *selector* form
 * and are correct — which is what makes the pattern read as safe.
 *
 * 🔑 **A 500 from a route that already did the work is worse than a 500.** The
 * operator sees failure and retries a destructive operation. Here the retry hit
 * the `already_revoked` early-return, which reads from `listPartnerQuotes` and
 * has always been fine — so the retry "worked", and the defect looked like a
 * transient blip rather than a certainty.
 *
 * Nothing caught it because no test ever POSTed this route: the three specs
 * that exercise revocation all flip `status` through the module service
 * directly, proving that a revoked quote stops pricing a cart and saying
 * nothing about whether an admin can revoke one. Same shape as the three
 * #1439 S11 defects.
 */
setupSharedTestSuite(() => {
  describe("POST /admin/quotes/:id/revoke (#1389 S5)", () => {
    let seed: QuoteFixture
    let adminHeaders: { headers: Record<string, string> }

    const container = () => getSharedTestEnv().getContainer()

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      seed = await setupQuoteFixture(api, getContainer)
    })

    const mint = async (overrides: Record<string, any> = {}) => {
      const { api } = getSharedTestEnv()
      const res = await api.post("/partners/quotes", mintBody(seed, overrides), {
        headers: seed.headers,
      })
      return res.data
    }

    it("🔴 answers 200, not 500, and reports what it deleted", async () => {
      const minted = await mint({
        buyer_email: `revoke-${seed.unique}@jaalyantra.test`,
      })

      const res = await getSharedTestEnv().api.post(
        `/admin/quotes/${minted.quote.id}/revoke`,
        {},
        adminHeaders
      )

      // The whole point: the status code has to agree with what happened.
      expect(res.status).toBe(200)
      expect(res.data.quote.status).toBe("revoked")
      expect(res.data.price_list_deleted).toBe(true)
    })

    /**
     * The status flag is the cheap half. A revoke that leaves the price list
     * alive kills the link and keeps the discount — the buyer goes on getting
     * quoted prices in any cart they build.
     */
    it("actually deletes the price list, not just the flag", async () => {
      const minted = await mint({
        buyer_email: `revoke-pl-${seed.unique}@jaalyantra.test`,
      })
      const priceListId = minted.quote.price_list_id
      expect(priceListId).toBeTruthy()

      await getSharedTestEnv().api.post(
        `/admin/quotes/${minted.quote.id}/revoke`,
        {},
        adminHeaders
      )

      const err = await getSharedTestEnv()
        .api.get(`/admin/price-lists/${priceListId}`, adminHeaders)
        .catch((e: any) => e.response)

      expect(err.status).toBe(404)
    })

    it("is idempotent — a second revoke is a no-op, not an error", async () => {
      const minted = await mint({
        buyer_email: `revoke-idem-${seed.unique}@jaalyantra.test`,
      })
      const { api } = getSharedTestEnv()

      const first = await api.post(
        `/admin/quotes/${minted.quote.id}/revoke`,
        {},
        adminHeaders
      )
      const second = await api.post(
        `/admin/quotes/${minted.quote.id}/revoke`,
        {},
        adminHeaders
      )

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(second.data.already_revoked).toBe(true)
      expect(second.data.quote.status).toBe("revoked")
    })

    it("leaves an audit trail an operator can read back", async () => {
      const minted = await mint({
        buyer_email: `revoke-evt-${seed.unique}@jaalyantra.test`,
      })
      await getSharedTestEnv().api.post(
        `/admin/quotes/${minted.quote.id}/revoke`,
        {},
        adminHeaders
      )

      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      const events = await service.listEvents(minted.quote.id)

      expect(events.some((e: any) => e.type === "revoked")).toBe(true)
    })

    it("404s an unknown quote", async () => {
      const err = await getSharedTestEnv()
        .api.post("/admin/quotes/quote_does_not_exist/revoke", {}, adminHeaders)
        .catch((e: any) => e.response)

      expect(err.status).toBe(404)
    })
  })
})
