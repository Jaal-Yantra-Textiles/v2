import { buildCartRecoveryLink, partnerStorefrontOrigin } from "../recovery-link"

/**
 * Where an abandoned-cart reminder actually sends someone.
 *
 * The live flow sent every buyer on the platform to `cicilabel.com` with no
 * country segment — the wrong shop, and a prefix the middleware fills in with
 * the DEFAULT region. For an AUD cart that means an India/INR checkout: PayU
 * instead of Stripe, and an address form that silently refuses to submit.
 */
const PARTNER = {
  storefront_domain: "saransh.cicilabel.com",
  custom_domain: null,
  custom_domain_verified: false,
}

const base = {
  cart_id: "cart_01M1NE10SYX1HR25H797SDJFHF",
  country_code: "au",
  fallback_origin: "https://cicilabel.com",
  fallback_country: "in",
}

describe("partnerStorefrontOrigin", () => {
  it("uses the provisioned subdomain", () => {
    expect(partnerStorefrontOrigin(PARTNER)).toBe("https://saransh.cicilabel.com")
  })

  it("prefers a VERIFIED custom domain", () => {
    expect(
      partnerStorefrontOrigin({
        ...PARTNER,
        custom_domain: "shop.saransh.com",
        custom_domain_verified: true,
      })
    ).toBe("https://shop.saransh.com")
  })

  it("🔴 ignores an UNVERIFIED custom domain", () => {
    // A verified domain is not a deployed storefront either, but an unverified
    // one is not even ours to link to.
    expect(
      partnerStorefrontOrigin({
        ...PARTNER,
        custom_domain: "not-mine.example.com",
        custom_domain_verified: false,
      })
    ).toBe("https://saransh.cicilabel.com")
  })

  it("adds a scheme, and does not double one that is already there", () => {
    expect(partnerStorefrontOrigin({ storefront_domain: "https://a.com" })).toBe(
      "https://a.com"
    )
    expect(partnerStorefrontOrigin({ storefront_domain: "a.com" })).toBe(
      "https://a.com"
    )
  })

  it("returns null for a partner with no storefront", () => {
    expect(partnerStorefrontOrigin({ storefront_domain: "" })).toBeNull()
    expect(partnerStorefrontOrigin(null)).toBeNull()
  })
})

describe("buildCartRecoveryLink", () => {
  it("sends the buyer to the PARTNER's shop, under the cart's own country", () => {
    const r = buildCartRecoveryLink({ ...base, partner: PARTNER })

    expect(r.url).toBe(
      "https://saransh.cicilabel.com/au/checkout/cart/cart_01M1NE10SYX1HR25H797SDJFHF"
    )
    expect(r.host_source).toBe("partner")
    expect(r.country_source).toBe("cart")
  })

  it("falls back to the platform host when the partner has no storefront", () => {
    const r = buildCartRecoveryLink({ ...base, partner: null })

    expect(r.url).toBe(
      "https://cicilabel.com/au/checkout/cart/cart_01M1NE10SYX1HR25H797SDJFHF"
    )
    expect(r.host_source).toBe("fallback")
    // Still the CART's country — the wrong host is survivable, the wrong
    // region is what breaks checkout.
    expect(r.country_source).toBe("cart")
  })

  it("🔴 refuses to build a link with no country rather than let the middleware pick one", () => {
    const r = buildCartRecoveryLink({
      ...base,
      partner: PARTNER,
      country_code: null,
      fallback_country: null,
    })

    // A missing link is recoverable. A link that silently re-regions the cart
    // is the defect this whole thing exists to stop.
    expect(r.url).toBeNull()
    expect(r.country_source).toBe("none")
    expect(r.reason).toMatch(/re-regioned/i)
  })

  it("uses the fallback country only when the cart names none", () => {
    const r = buildCartRecoveryLink({
      ...base,
      partner: PARTNER,
      country_code: "",
    })

    expect(r.url).toMatch(/\/in\/checkout\/cart\//)
    expect(r.country_source).toBe("fallback")
  })

  it("refuses when no host is known at all", () => {
    const r = buildCartRecoveryLink({
      ...base,
      partner: null,
      fallback_origin: null,
    })

    expect(r.url).toBeNull()
    expect(r.host_source).toBe("none")
  })

  it("refuses without a cart id", () => {
    expect(buildCartRecoveryLink({ ...base, cart_id: "" }).url).toBeNull()
  })

  it("lower-cases the country and trims a trailing slash on the origin", () => {
    const r = buildCartRecoveryLink({
      ...base,
      partner: { storefront_domain: "saransh.cicilabel.com/" },
      country_code: "AU",
    })

    expect(r.url).toBe(
      "https://saransh.cicilabel.com/au/checkout/cart/cart_01M1NE10SYX1HR25H797SDJFHF"
    )
  })
})
