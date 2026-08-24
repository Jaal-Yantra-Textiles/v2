import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  TEST_PARTNER_PASSWORD,
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
  /**
   * 🔴 ONE fixture, at the TOP level, shared by both describes.
   *
   * The runner snapshots the database on the FIRST `beforeEach` and restores
   * that snapshot before every test after it. A `beforeAll` nested in the
   * second describe therefore runs AFTER the snapshot was taken, so everything
   * it creates — including the partner's auth identity — is rolled back before
   * its first test runs. The symptom is not a missing row: it is a **401 on
   * every request in that describe**, which reads as a broken auth header.
   */
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

  describe("POST /admin/quotes/:id/revoke (#1389 S5)", () => {
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

  /**
   * The partner twin (#1517).
   *
   * A partner who mis-quoted could not withdraw it: there was no route, so no
   * MCP tool, and `mint_quote`'s own guidance told the assistant to "revoke the
   * old quote first" — an action nothing on that surface could perform. Their
   * only recourse was to re-mint, which emails the buyer a NEW number they did
   * not ask for, or to wait for expiry.
   *
   * The body is shared with the admin route (`lib/revoke-quote.ts`), so the
   * assertions that matter here are the ones the admin route cannot make: that
   * ownership is enforced against the AUTH CONTEXT rather than the URL, and
   * that an accepted quote is refused.
   */
  describe("POST /partners/quotes/:id/revoke (#1517)", () => {
    const revoke = (id: string, headers: Record<string, string> = seed.headers) =>
      getSharedTestEnv()
        .api.post(`/partners/quotes/${id}/revoke`, {}, { headers })
        .catch((e: any) => e.response)

    it("🔴 revokes the partner's own quote — 200, and the price list is GONE", async () => {
      const minted = await mint({
        buyer_email: `p-revoke-${seed.unique}@jaalyantra.test`,
      })
      const priceListId = minted.quote.price_list_id

      const res = await revoke(minted.quote.id)

      expect(res.status).toBe(200)
      expect(res.data.quote.status).toBe("revoked")
      expect(res.data.price_list_deleted).toBe(true)

      /**
       * The status flag is the cheap half. If the list outlives the quote the
       * buyer keeps the quoted prices in any cart they build — the link dies
       * and the discount does not, which is the failure nobody would notice.
       */
      expect(priceListId).toBeTruthy()
      const pricing: any = container().resolve("pricing")
      const lists = await pricing.listPriceLists({ id: [priceListId] })
      expect(lists.length).toBe(0)

      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      const events = await service.listEvents(minted.quote.id)
      const revoked = events.find((e: any) => e.type === "revoked")
      // The log is what a disputed price is argued from, so it has to say WHO.
      expect(revoked?.actor_type).toBe("partner")
    })

    it("🔴 404s another partner's quote — the id in the URL proves nothing", async () => {
      const minted = await mint({
        buyer_email: `p-revoke-x-${seed.unique}@jaalyantra.test`,
      })

      const { api } = getSharedTestEnv()
      const unique = `${seed.unique}-x`
      const email = `stranger-${unique}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      let login = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      await api.post(
        "/partners",
        {
          name: `Stranger ${unique}`,
          handle: `stranger-${unique}`,
          admin: { email, first_name: "Stranger", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      // Re-login: the token minted before the partner existed carries no actor.
      login = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const res = await revoke(minted.quote.id, {
        Authorization: `Bearer ${login.data.token}`,
      })

      // 404, not 403: a partner has no business learning that someone else's
      // quote id is real (#1404).
      expect(res.status).toBe(404)

      // And it did not half-run. The owner's quote is untouched.
      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      const [after] = await service.listPartnerQuotes({ id: minted.quote.id })
      expect(after.status).toBe("active")
    })

    it("🔴 refuses a quote the buyer has ALREADY ACCEPTED, and says why", async () => {
      const minted = await mint({
        buyer_email: `p-revoke-acc-${seed.unique}@jaalyantra.test`,
      })
      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      await service.updatePartnerQuotes({
        id: minted.quote.id,
        accepted_at: new Date(),
      })

      const res = await revoke(minted.quote.id)

      // 400 rather than 409: the framework REPLACES a CONFLICT message with a
      // generic "retry with an Idempotency-Key" line, which would tell the
      // partner to retry the one thing that cannot work.
      expect(res.status).toBe(400)
      expect(res.data.message).toContain("accepted")

      // The price list must survive — the accepted cart is priced from it.
      const [after] = await service.listPartnerQuotes({ id: minted.quote.id })
      expect(after.status).toBe("active")
      const pricing: any = container().resolve("pricing")
      const lists = await pricing.listPriceLists({ id: [minted.quote.price_list_id] })
      expect(lists.length).toBe(1)
    })

    it("is idempotent — a second revoke is a no-op, not an error", async () => {
      const minted = await mint({
        buyer_email: `p-revoke-idem-${seed.unique}@jaalyantra.test`,
      })

      const first = await revoke(minted.quote.id)
      const second = await revoke(minted.quote.id)

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(second.data.already_revoked).toBe(true)
      expect(second.data.quote.status).toBe("revoked")
    })

    it("404s an unknown quote", async () => {
      const res = await revoke("quote_does_not_exist")
      expect(res.status).toBe(404)
    })
  })
})
