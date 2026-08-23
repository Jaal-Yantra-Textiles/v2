import { buildQuoteBuyerUrl, resolveQuoteBuyerLink } from "../lib/quote-link"

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

describe("resolveQuoteBuyerLink", () => {
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

  it("returns null — never throws — when the partner has no domain at all", async () => {
    const scope = scopeWith([
      { id: "part_1", custom_domain: null, custom_domain_verified: false, storefront_domain: null },
    ])
    await expect(resolveQuoteBuyerLink(scope, base)).resolves.toBeNull()
  })

  it("returns null when the partner read falls over, rather than failing the mint", async () => {
    const scope = scopeWith([], { throws: true })
    await expect(resolveQuoteBuyerLink(scope, base)).resolves.toBeNull()
  })

  it("does not read the partner at all without an id or a token", async () => {
    const scope = { resolve: () => ({ graph: async () => { throw new Error("must not be called") } }) }
    await expect(
      resolveQuoteBuyerLink(scope, { ...base, partner_id: null })
    ).resolves.toBeNull()
    await expect(
      resolveQuoteBuyerLink(scope, { ...base, token: null })
    ).resolves.toBeNull()
  })
})
