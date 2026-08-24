import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * One partner's quote must not render on another partner's storefront (#1439 S15).
 *
 * ## The hole this pins shut
 *
 * `/store/b2b/quotes/:token` looked the quote up by token hash and rendered it,
 * never asking whether the storefront doing the asking was the one it was
 * minted for. Reproduced against a real database with three different stores:
 * every publishable key returned 200 for the same token. A competitor's shop
 * would render the buyer's name, their company, both parties' tax
 * registrations and the negotiated prices.
 *
 * The accept route matters more still — it builds a real cart bound to the
 * quote's own customer and minted price list.
 *
 * 🔑 The token being high-entropy is why this is unlikely to be *found*. It is
 * not why it would be safe: these links are forwarded to procurement, pasted
 * into purchase orders and quoted back in support threads.
 *
 * ## What this does NOT assert
 *
 * The guard refuses only a PROVEN mismatch — both sides resolvable and
 * different. It deliberately allows (and logs) the unresolvable cases, because
 * 24 of 28 stores carry no `default_sales_channel_id` and 12 of 16 existing
 * quotes have no `store_id`, so failing closed would take the buyer page down
 * for most tenants. Those two backfills are what turns this into a real
 * boundary; see `quote-tenant-guard.ts`.
 */
setupSharedTestSuite(() => {
  describe("GET/POST /store/b2b/quotes/:token — tenant isolation (#1439 S15)", () => {
    let seedA: QuoteFixture
    let seedB: QuoteFixture
    let token: string

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())

      // Two independent tenants. The fixture provisions its own store, sales
      // channel and publishable key each time, which is exactly the shape of
      // two partners on the platform.
      seedA = await setupQuoteFixture(api, getContainer)
      seedB = await setupQuoteFixture(api, getContainer)

      const mint = await api.post(
        "/partners/quotes",
        mintBody(seedA, {
          buyer_email: `tenant-${seedA.unique}@jaalyantra.test`,
        }),
        { headers: seedA.headers }
      )
      token = mint.data.token
    })

    it("renders for the storefront it was minted for", () => {
      // The control. Without this the test below could pass because the token
      // is simply broken.
      return getSharedTestEnv()
        .api.get(`/store/b2b/quotes/${token}`, {
          headers: { "x-publishable-api-key": seedA.publishableKey },
        })
        .then((res: any) => {
          expect(res.status).toBe(200)
          expect(res.data.quote.lines.length).toBeGreaterThan(0)
        })
    })

    it("🔴 404s on ANOTHER partner's storefront, leaking nothing", async () => {
      const { api } = getSharedTestEnv()
      const err = await api
        .get(`/store/b2b/quotes/${token}`, {
          headers: { "x-publishable-api-key": seedB.publishableKey },
        })
        .catch((e: any) => e)

      expect(err?.response?.status).toBe(404)
      // 404, not 403 — a prober must not learn the token is real by being told
      // they are on the wrong shop.
      const body = JSON.stringify(err?.response?.data ?? {})
      expect(body).not.toContain(seedA.unique)
      expect(body.toLowerCase()).not.toContain("tenant")
    })

    it("🔴 refuses to build a cart from another partner's storefront", async () => {
      // The graver half: this route binds a cart to the quote's own customer
      // and its minted price list.
      const { api } = getSharedTestEnv()
      const err = await api
        .post(
          `/store/b2b/quotes/${token}/accept`,
          {},
          { headers: { "x-publishable-api-key": seedB.publishableKey } }
        )
        .catch((e: any) => e)

      expect(err?.response?.status).toBe(404)
    })

    it("still accepts on the storefront that owns it", async () => {
      // The guard must refuse the other tenant WITHOUT breaking the real one —
      // the failure mode that matters more than the leak (#1397).
      const { api } = getSharedTestEnv()
      const res = await api.post(
        `/store/b2b/quotes/${token}/accept`,
        {},
        { headers: { "x-publishable-api-key": seedA.publishableKey } }
      )
      expect(res.status).toBe(201)
      expect(res.data.acceptance.cart_id).toBeTruthy()
    })
  })
})
