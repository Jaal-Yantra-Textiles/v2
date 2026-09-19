import { resolveCartCheckoutLink,
  platformFallbackOrigin,
} from "../resolve-cart-link"

/**
 * The design-order create route used to build its own checkout url —
 * `STORE_URL + "/checkout/cart/" + id` — one hardcoded shop for 14 tenants,
 * with no country segment. These pin the behaviour it now shares with
 * `/r/cart/:id` so the two cannot drift apart again.
 */

const scopeWith = (graph: (args: any) => Promise<any>) => ({
  resolve: (key: string) =>
    key === "logger"
      ? { warn: jest.fn(), info: jest.fn() }
      : { graph },
})

const CART = {
  id: "cart_01",
  completed_at: null,
  sales_channel_id: "sc_01",
  region: { countries: [{ iso_2: "IN" }] },
}

const PARTNER_STORE = {
  id: "store_01",
  partner: {
    id: "p_01",
    storefront_domain: "sharlho.cicilabel.com",
    custom_domain: null,
    custom_domain_verified: false,
  },
}

/** Answers the cart query, then the store query, in the order they are made. */
const graphFor = (cart: any, store: any) =>
  jest.fn(async (args: any) =>
    args.entity === "cart" ? { data: cart ? [cart] : [] } : { data: store ? [store] : [] }
  )

beforeEach(() => {
  process.env.STORE_URL = "https://cicilabel.com"
  delete process.env.NEXT_PUBLIC_DEFAULT_REGION
})

describe("resolveCartCheckoutLink", () => {
  it("sends the buyer to the PARTNER's own shop, under the cart's country", async () => {
    const scope = scopeWith(graphFor(CART, PARTNER_STORE))
    const { link } = await resolveCartCheckoutLink(scope, "cart_01")

    expect(link.url).toBe("https://sharlho.cicilabel.com/in/checkout/cart/cart_01")
    expect(link.host_source).toBe("partner")
    expect(link.country_source).toBe("cart")
  })

  it("falls back to the platform host when the store has no partner", async () => {
    const scope = scopeWith(graphFor(CART, { id: "store_01", partner: null }))
    const { link } = await resolveCartCheckoutLink(scope, "cart_01")

    expect(link.url).toBe("https://cicilabel.com/in/checkout/cart/cart_01")
    expect(link.host_source).toBe("fallback")
  })

  /**
   * 🔴 The bug this whole file exists for. Without a country the storefront
   * middleware substitutes NEXT_PUBLIC_DEFAULT_REGION and re-regions the cart —
   * an INR cart priced at a EUR checkout. No country, no link.
   */
  it("REFUSES a link when neither the cart nor the platform names a country", async () => {
    const noCountry = { ...CART, region: { countries: [] } }
    const scope = scopeWith(graphFor(noCountry, PARTNER_STORE))
    const { link } = await resolveCartCheckoutLink(scope, "cart_01")

    expect(link.url).toBeNull()
    expect(link.country_source).toBe("none")
  })

  it("reports a missing cart instead of throwing", async () => {
    const scope = scopeWith(graphFor(null, null))
    const { cart, link } = await resolveCartCheckoutLink(scope, "cart_nope")

    expect(cart).toBeNull()
    expect(link.url).toBeNull()
  })

  /** A read failure must not cost the caller the order it just created. */
  it("survives a lookup that throws", async () => {
    const scope = scopeWith(jest.fn(async () => {
      throw new Error("db is having a day")
    }))
    const { cart, link } = await resolveCartCheckoutLink(scope, "cart_01")

    expect(cart).toBeNull()
    expect(link.url).toBeNull()
  })

  it("carries completed_at through, so a caller can refuse a second order", async () => {
    const done = { ...CART, completed_at: "2026-09-17T00:00:00Z" }
    const scope = scopeWith(graphFor(done, PARTNER_STORE))
    const { cart } = await resolveCartCheckoutLink(scope, "cart_01")

    expect(cart?.completed_at).toBe("2026-09-17T00:00:00Z")
  })
})

/**
 * The host a buyer lands on when no partner storefront can be named.
 *
 * 🔴 `FRONTEND_URL` is the CORPORATE site, not a shop. Prod has
 * `STORE_URL` unset and `FRONTEND_URL=https://jaalyantra.com`, so while it sat
 * in this chain every fallback checkout link pointed at a site with no cart.
 */
describe("platformFallbackOrigin", () => {
  const saved = { store: process.env.STORE_URL, front: process.env.FRONTEND_URL }
  afterEach(() => {
    if (saved.store === undefined) delete process.env.STORE_URL
    else process.env.STORE_URL = saved.store
    if (saved.front === undefined) delete process.env.FRONTEND_URL
    else process.env.FRONTEND_URL = saved.front
  })

  it("uses STORE_URL when it is set", () => {
    process.env.STORE_URL = "https://shop.example.com"
    expect(platformFallbackOrigin()).toBe("https://shop.example.com")
  })

  it("🔴 IGNORES FRONTEND_URL — prod's exact shape", () => {
    delete process.env.STORE_URL
    process.env.FRONTEND_URL = "https://jaalyantra.com"
    expect(platformFallbackOrigin()).toBe("https://cicilabel.com")
    expect(platformFallbackOrigin()).not.toContain("jaalyantra")
  })

  it("falls back to the storefront, not a brochure, when neither is set", () => {
    delete process.env.STORE_URL
    delete process.env.FRONTEND_URL
    expect(platformFallbackOrigin()).toBe("https://cicilabel.com")
  })
})
