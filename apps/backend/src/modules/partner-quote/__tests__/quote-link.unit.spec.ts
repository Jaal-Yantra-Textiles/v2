import {
  buildQuoteBuyerUrl,
  houseStorefrontOrigin,
  resolveQuoteBuyerLink,
} from "../lib/quote-link"

/**
 * The buyer link (#1420).
 *
 * The link is the ONLY copy of the token, so the assertions that matter are
 * the refusals: a URL missing its country segment 404s on the storefront, and
 * a URL pointed at an unverified custom domain hands a buyer's quote to a host
 * we do not control. Both look exactly like a working link in a happy-path
 * test — they are strings, and they are not empty.
 */

const scopeWith = (partners: any[], opts: { throws?: boolean } = {}) => ({
  resolve: () => ({
    graph: async (args: any) => {
      if (opts.throws) throw new Error("query fell over")
      // #1397 — never an unfiltered partner read.
      expect(args.filters?.id).toBeDefined()
      return { data: partners }
    },
  }),
})

describe("buildQuoteBuyerUrl", () => {
  it("composes origin + country + token", () => {
    expect(
      buildQuoteBuyerUrl({
        origin: "https://unique-pashmina.jaalyantra.com",
        countryCode: "DE",
        token: "tok_abc",
      })
    ).toBe("https://unique-pashmina.jaalyantra.com/de/quotes/tok_abc")
  })

  it("refuses to build a link with no country segment", () => {
    // The control. A `/quotes/<token>` URL is a perfectly plausible string and
    // a guaranteed 404 — returning it would look like success everywhere.
    expect(
      buildQuoteBuyerUrl({
        origin: "https://shop.example.com",
        countryCode: null,
        token: "tok_abc",
      })
    ).toBeNull()
  })

  it("refuses when there is no host, and when there is no token", () => {
    expect(
      buildQuoteBuyerUrl({ origin: null, countryCode: "in", token: "tok_abc" })
    ).toBeNull()
    expect(
      buildQuoteBuyerUrl({
        origin: "https://shop.example.com",
        countryCode: "in",
        token: "   ",
      })
    ).toBeNull()
  })

  it("does not double the slash when the origin carries one", () => {
    expect(
      buildQuoteBuyerUrl({
        origin: "https://shop.example.com/",
        countryCode: "IN",
        token: "t",
      })
    ).toBe("https://shop.example.com/in/quotes/t")
  })
})

describe("houseStorefrontOrigin", () => {
  it("schemes a bare ROOT_DOMAIN", () => {
    expect(houseStorefrontOrigin({ ROOT_DOMAIN: "cicilabel.com" })).toBe(
      "https://cicilabel.com"
    )
  })

  it("prefers ROOT_DOMAIN over FRONTEND_URL and passes a full URL through", () => {
    expect(
      houseStorefrontOrigin({
        ROOT_DOMAIN: "cicilabel.com",
        FRONTEND_URL: "https://jaalyantra.com",
      })
    ).toBe("https://cicilabel.com")
    expect(houseStorefrontOrigin({ FRONTEND_URL: "https://jaalyantra.com" })).toBe(
      "https://jaalyantra.com"
    )
  })

  it("returns null when neither is configured, rather than a broken host", () => {
    expect(houseStorefrontOrigin({})).toBeNull()
    expect(houseStorefrontOrigin({ ROOT_DOMAIN: "   " })).toBeNull()
  })
})

describe("resolveQuoteBuyerLink", () => {
  const HOUSE = { ROOT_DOMAIN: "cicilabel.com" }
  /**
   * ⚠️ `await` INSIDE the try, not around the helper. `resolveQuoteBuyerLink`
   * reads `process.env` after its own await, so a synchronous helper restores
   * the environment before the value under test is ever read — and the test
   * passes or fails on whatever the ambient .env happens to hold.
   */
  const withHouse = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = process.env.ROOT_DOMAIN
    process.env.ROOT_DOMAIN = HOUSE.ROOT_DOMAIN
    try {
      return await fn()
    } finally {
      if (prev === undefined) delete process.env.ROOT_DOMAIN
      else process.env.ROOT_DOMAIN = prev
    }
  }

  const noHouse = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prevRoot = process.env.ROOT_DOMAIN
    const prevFront = process.env.FRONTEND_URL
    delete process.env.ROOT_DOMAIN
    delete process.env.FRONTEND_URL
    try {
      return await fn()
    } finally {
      if (prevRoot !== undefined) process.env.ROOT_DOMAIN = prevRoot
      if (prevFront !== undefined) process.env.FRONTEND_URL = prevFront
    }
  }

  const base = {
    partner_id: "part_1",
    destination_country_code: "DE",
    token: "tok_abc",
  }

  it("uses a VERIFIED custom domain", async () => {
    const scope = scopeWith([
      {
        id: "part_1",
        custom_domain: "uniquepashmina.com",
        custom_domain_verified: true,
        storefront_domain: "unique-pashmina.jaalyantra.com",
      },
    ])

    await expect(resolveQuoteBuyerLink(scope, base)).resolves.toBe(
      "https://uniquepashmina.com/de/quotes/tok_abc"
    )
  })

  it("falls back to the provisioned subdomain when the custom domain is UNVERIFIED", async () => {
    // The control case. `custom_domain` is whatever the partner typed into the
    // connect form; both minted panels preferred it unconditionally, which
    // points the buyer at a host nobody has proved we own.
    const scope = scopeWith([
      {
        id: "part_1",
        custom_domain: "not-ours-yet.com",
        custom_domain_verified: false,
        storefront_domain: "unique-pashmina.jaalyantra.com",
      },
    ])

    await expect(resolveQuoteBuyerLink(scope, base)).resolves.toBe(
      "https://unique-pashmina.jaalyantra.com/de/quotes/tok_abc"
    )
  })

  it("🔑 the house domain is the LAST resort, never preferred over the partner's", async () => {
    // Preferring it would quietly move every partner's buyer onto our shop —
    // off the page that names the producer and prices their catalogue.
    const scope = scopeWith([
      {
        id: "part_1",
        custom_domain: null,
        custom_domain_verified: false,
        storefront_domain: "unique-pashmina.jaalyantra.com",
      },
    ])

    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, base))
    ).resolves.toBe("https://unique-pashmina.jaalyantra.com/de/quotes/tok_abc")
  })

  /**
   * 🔴 Was "falls back to the house storefront". It does not, because that link
   * does not work: `assertQuoteVisibleToCaller` refuses any read whose key
   * resolves to a store other than the quote's own. Verified live against quote
   * `01M1BPV6TM…` — `GET /store/b2b/quotes/<token>` was **404** under the house
   * publishable key and **200** under the owning partner store's.
   *
   * Null makes `deliverQuoteEmail` refuse to send and record why. A 404 dressed
   * as a link would have gone to the buyer instead.
   */
  it("🔴 returns NULL, not a house link, when a PARTNER has no storefront", async () => {
    const scope = scopeWith([
      { id: "part_1", custom_domain: null, custom_domain_verified: false, storefront_domain: null },
    ])

    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, base))
    ).resolves.toBeNull()
  })

  it("🔴 a VERIFIED custom domain with no storefront is not a link either", async () => {
    // The production row: saranshsharma.me, verified, nothing deployed behind
    // it. It served an unrelated personal site and 404'd the quote page.
    const scope = scopeWith([
      {
        id: "part_1",
        custom_domain: "saranshsharma.me",
        custom_domain_verified: true,
        storefront_domain: null,
      },
    ])

    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, base))
    ).resolves.toBeNull()
  })

  it("uses the house storefront for a quote with no partner at all", async () => {
    const scope = { resolve: () => ({ graph: async () => { throw new Error("must not be called") } }) }
    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, { ...base, partner_id: null }))
    ).resolves.toBe("https://cicilabel.com/de/quotes/tok_abc")
  })

  it("🔴 returns null when the partner read FALLS OVER", async () => {
    // A failed query is not evidence the partner has no shop — but nor does it
    // make a house link work for a partner's quote, and a link to a not-found
    // page is worse for the buyer than the mint saying it could not build one.
    const scope = scopeWith([], { throws: true })
    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, base))
    ).resolves.toBeNull()
  })

  it("still returns null when there is no partner domain AND no house domain", async () => {
    const scope = scopeWith([
      { id: "part_1", custom_domain: null, custom_domain_verified: false, storefront_domain: null },
    ])
    await expect(noHouse(() => resolveQuoteBuyerLink(scope, base))).resolves.toBeNull()
  })

  it("never builds a link without a token, house domain or not", async () => {
    const scope = { resolve: () => ({ graph: async () => { throw new Error("must not be called") } }) }
    await expect(
      withHouse(() => resolveQuoteBuyerLink(scope, { ...base, token: null }))
    ).resolves.toBeNull()
  })
})
