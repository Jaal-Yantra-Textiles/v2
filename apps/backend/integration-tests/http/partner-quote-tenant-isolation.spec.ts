import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
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
 * ## It fails CLOSED, and these tests are what say so
 *
 * S15 shipped this refusing only a PROVEN mismatch — both sides resolvable and
 * different — and allowing every unresolvable case, sized off dev-database
 * counts that turned out to be e2e detritus. Measured on prod 2026-08-24:
 * 8 of 8 quotes carry a `store_id`, 0 of 13 stores lack
 * `default_sales_channel_id`, and all 14 publishable keys resolve to a store.
 * Nothing was relying on the gap, so each escape hatch is now a refusal and
 * each has a test below. See `quote-tenant-guard.ts`.
 */
setupSharedTestSuite(() => {
  describe("GET/POST /store/b2b/quotes/:token — tenant isolation (#1439 S15)", () => {
    let seedA: QuoteFixture
    let seedB: QuoteFixture
    let token: string
    let adminConfig: any

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminConfig = await getAuthHeaders(api)

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

    it("🔴 404s a quote that carries no store_id at all", async () => {
      // The first escape hatch S15 left open. A pre-S15 row (or a mint path
      // that drops the column) is a document no storefront can be shown to
      // own — it used to render on every one of them.
      //
      // 🔑 This mints its own quote and strips the column rather than reusing
      // the shared one, so it cannot disturb the acceptance test below.
      const { api, getContainer } = getSharedTestEnv()
      const mint = await api.post(
        "/partners/quotes",
        mintBody(seedA, {
          buyer_email: `untagged-${seedA.unique}@jaalyantra.test`,
        }),
        { headers: seedA.headers }
      )
      const orphanToken = mint.data.token

      // The control: it renders on its own storefront while tagged.
      const before = await api.get(`/store/b2b/quotes/${orphanToken}`, {
        headers: { "x-publishable-api-key": seedA.publishableKey },
      })
      expect(before.status).toBe(200)

      const service: any = getContainer().resolve("partnerQuote")
      // The entity form returns an object, not an array — do not destructure.
      await service.updatePartnerQuotes({ id: mint.data.quote.id, store_id: null })

      const err = await api
        .get(`/store/b2b/quotes/${orphanToken}`, {
          headers: { "x-publishable-api-key": seedA.publishableKey },
        })
        .catch((e: any) => e)

      expect(err?.response?.status).toBe(404)
    })

    it("🔴 404s when the calling key resolves to no store", async () => {
      // The second and third hatches, which are one situation in practice: a
      // key whose sales channel is nobody's default (the #1397 dangling key)
      // leaves the caller unidentifiable. Unidentifiable is not permission.
      const { api } = getSharedTestEnv()
      const orphanKey = await api.post(
        "/admin/api-keys",
        { title: `Orphan ${seedA.unique}`, type: "publishable" },
        adminConfig
      )
      const channel = await api.post(
        "/admin/sales-channels",
        { name: `Orphan channel ${seedA.unique}` },
        adminConfig
      )
      // Linked to a channel that is no store's default_sales_channel_id, so
      // `getStoreFromPublishableKey` returns null.
      await api.post(
        `/admin/api-keys/${orphanKey.data.api_key.id}/sales-channels`,
        { add: [channel.data.sales_channel.id] },
        adminConfig
      )

      const err = await api
        .get(`/store/b2b/quotes/${token}`, {
          headers: { "x-publishable-api-key": orphanKey.data.api_key.token },
        })
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
