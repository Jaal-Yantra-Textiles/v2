import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * The buyer's quantity dial, on the READ side (#1439 S13).
 *
 * ## Why this exists separately from the accept spec
 *
 * `partner-quote-accept.spec.ts` proves the dial survives into the cart. This
 * proves the other half — that the document the buyer is looking at when they
 * press the button was actually re-priced through the same numbers. Both halves
 * have to hold or the feature is a lie in one direction or the other: a cart
 * that ignores the dial charges for a basket nobody saw, and a page that
 * ignores it shows a price nobody will be charged.
 *
 * ## What the buyer page depends on and nothing else asserted
 *
 * 🔴 `quoted_quantity` is consumed by the storefront to tell the buyer which
 * number is theirs and which is the partner's ("Quoted at 25"). Both
 * storefronts ship with `ignoreBuildErrors: true` and neither has a type-level
 * gate worth the name, so if this field silently stopped being emitted the page
 * would keep rendering — just without ever admitting the basket had been
 * changed, while the header still called it "your quote". Nothing but an
 * assertion here catches that.
 */
setupSharedTestSuite(() => {
  describe("GET /store/b2b/quotes/:token?lines= — the buyer's dial (#1439 S13)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
    })

    /**
     * A fresh quote per test. Re-quoting the same buyer stacks price lists
     * (#1435) and the core tie-breaks to the CHEAPEST, so a shared quote would
     * make these assertions depend on execution order.
     */
    const mint = async (label: string) => {
      const { api } = getSharedTestEnv()
      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `view-dial-${label}-${seed.unique}@jaalyantra.test`,
        }),
        { headers: seed.headers }
      )
      return res.data.token as string
    }

    /**
     * 🔑 The wire form here is JSON, not the `variant:qty` pairs the storefront
     * puts in its own URL. Two different hops: the browser's `?lines=` is a
     * legible thing a buyer can see in a link they forward, and the Next server
     * translates it to JSON at the boundary in `retrieveQuote`. Asserting the
     * colon form against this route would pass for the wrong reason — an
     * unparseable dial falls back to the quoted basket, which is what most of
     * these tests would then be checking.
     */
    const view = async (
      token: string,
      dial?: Array<{ variant_id: string; quantity: number }> | string
    ) => {
      const { api } = getSharedTestEnv()
      const raw =
        dial === undefined
          ? null
          : typeof dial === "string"
            ? dial
            : JSON.stringify(dial)
      const qs = raw === null ? "" : `?lines=${encodeURIComponent(raw)}`
      const res = await api.get(`/store/b2b/quotes/${token}${qs}`, {
        headers: storeHeaders,
      })
      return res.data.quote
    }

    const lineFor = (quote: any, variantId: string) =>
      quote.lines.find((l: any) => l.variant_id === variantId)

    it("reports the quoted quantity alongside the effective one", async () => {
      const quote = await view(await mint("plain"))

      // Undialled, the two agree — but they must both be PRESENT, because the
      // page decides whether to say "you changed this" by comparing them.
      for (const line of quote.lines) {
        expect(line.quoted_quantity).not.toBeNull()
        expect(line.quoted_quantity).toBe(line.quantity)
      }
      expect(lineFor(quote, seed.variantA.id).quoted_quantity).toBe(25)
      expect(lineFor(quote, seed.variantB.id).quoted_quantity).toBe(4)
    })

    it("🔴 re-prices the whole document through the dial, and keeps the quoted quantity intact", async () => {
      const token = await mint("moved")
      const before = await view(token)
      const after = await view(token, [
        { variant_id: seed.variantA.id, quantity: 50 },
      ])

      const movedLine = lineFor(after, seed.variantA.id)
      expect(movedLine.quantity).toBe(50)
      // The partner's number is untouched — this is the whole point of the
      // field. Without it the page cannot distinguish its own document from
      // the one that was sent.
      expect(movedLine.quoted_quantity).toBe(25)

      // The line the buyer did not touch stays exactly as quoted.
      const untouched = lineFor(after, seed.variantB.id)
      expect(untouched.quantity).toBe(4)
      expect(untouched.quoted_quantity).toBe(4)

      /**
       * 🔑 The reason the storefront does no arithmetic of its own: the SERVER
       * re-priced. A browser multiplying `unit_amount × qty` would be wrong the
       * moment a quantity crosses a price-list tier, a carrier weight slab or a
       * tax threshold — and wrong quietly, showing a total the cart will not
       * honour.
       */
      const beforeGoods = Number(before.live?.subtotal ?? before.quoted?.subtotal)
      const afterGoods = Number(after.live?.subtotal ?? after.quoted?.subtotal)
      expect(afterGoods).toBeGreaterThan(beforeGoods)
    })

    it("ignores a variant that is not on the quote rather than adding it", async () => {
      // The dial is a quantity control, never a way into the catalogue — the
      // same boundary acceptance enforces, held on the read side too.
      const token = await mint("foreign")
      const quote = await view(token, [
        { variant_id: "variant_not_on_this_quote", quantity: 99 },
      ])

      expect(quote.lines).toHaveLength(2)
      expect(lineFor(quote, seed.variantA.id).quantity).toBe(25)
      expect(lineFor(quote, "variant_not_on_this_quote")).toBeUndefined()
    })

    it("falls back to the quoted basket on a mangled dial instead of failing the page", async () => {
      /**
       * 🔴 A quote link gets forwarded to procurement, pasted into purchase
       * orders and wrapped by email clients. A truncated `?lines=` must cost
       * the buyer the dial, never their price — a 400 here is a buyer who
       * cannot see what they were quoted.
       */
      const token = await mint("mangled")
      const mangledDials = [
        "not-json-at-all",
        "{oops",
        // The colon form the BROWSER uses — legitimate one hop earlier, and
        // meaningless here. It must degrade, not 400.
        `${seed.variantA.id}:50`,
      ]
      for (const mangled of mangledDials) {
        const quote = await view(token, mangled)
        expect(quote.lines).toHaveLength(2)
        expect(lineFor(quote, seed.variantA.id).quantity).toBe(25)
        expect(lineFor(quote, seed.variantB.id).quantity).toBe(4)
      }
    })
  })
})
