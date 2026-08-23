import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * "Who is producing this", and the rule for when it is worth saying (#1428).
 *
 * ## Why this is conditional rather than always-on
 *
 * On a partner's own domain the partner IS the seller. Naming them again under
 * their own logo is noise, and reads like a disclosure the page is obliged to
 * make rather than the selling point it actually is. On a JYT-served
 * storefront the buyer has no idea whose hands made the cloth, and on a
 * handloom product that is the single most persuasive fact on the page.
 *
 * ## How "whose storefront is this" is decided
 *
 * NOT from the quote — `store_id` is always the partner's own store, because
 * both mint paths resolve it from the partner (`getPartnerStore`, and
 * `partner.stores[0]` on the admin route). Comparing the quote against itself
 * would answer "the partner's own" every single time and the band would never
 * render.
 *
 * The serving storefront comes from the REQUEST: the publishable key the
 * storefront sends resolves to its sales channels, which is the same signal
 * `/store/partner-showcase` already uses to tell "my own shop" from "someone
 * else's". If those channels include the partner's, the buyer is on the
 * partner's own shop.
 *
 * 🔑 Three states, not two — "cannot tell" is its own answer and it means SAY
 * NOTHING. A page served without a publishable key, or a partner with no sales
 * channel, must not be read as "therefore a JYT storefront": that would name a
 * producer on the partner's own site, which is precisely the noise this
 * condition exists to avoid.
 */

export type QuoteProducer = {
  id: string
  name: string | null
  handle: string | null
  logo: string | null
  country_code: string | null
  is_verified: boolean
  /** The partner's own shop, or null when they have no reachable domain. */
  url: string | null
  /**
   * The maker's own words, when there are any (#1428).
   *
   * ⚠️ Sourced from `provenance.maker_story`, which reads the PRODUCT's
   * `artisan_product_detail`. Neither the partner model nor
   * `partner_onboarding_profile` has a prose field — the profile is structured
   * facts (team size, weaving, price range), which is what the provenance rows
   * are built from. So a partner with no artisan detail on any quoted product
   * has no story to tell, and this is null rather than a paragraph invented
   * from their facts.
   */
  story: string | null
  /**
   * Short facts a buyer can scan: what kind of workshop, verified, where, and
   * the catalogue's own words for what is in the basket.
   *
   * 🔑 Every tag is a FACT we hold, never a marketing adjective. Nothing here
   * invents a claim about someone else's workshop.
   */
  tags: string[]
}

/** PURE: the scannable facts, deduped and ordered, with nothing invented. */
export function composeProducerTags(input: {
  workspace_type?: string | null
  is_verified?: boolean
  country_code?: string | null
  product_tags?: string[] | null
}): string[] {
  const tags: string[] = []

  if (input.workspace_type) {
    const t = String(input.workspace_type)
    tags.push(t.charAt(0).toUpperCase() + t.slice(1))
  }
  if (input.is_verified) tags.push("Verified maker")
  if (input.country_code) tags.push(String(input.country_code).toUpperCase())

  for (const tag of input.product_tags ?? []) {
    const clean = String(tag ?? "").trim()
    if (clean) tags.push(clean)
  }

  // Deduped case-insensitively — "Handloom" and "handloom" are one tag, and a
  // band showing both reads as a data problem to whoever is looking at it.
  const seen = new Set<string>()
  return tags.filter((t) => {
    const key = t.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * PURE: where "produced by" points.
 *
 * The order goes to this partner regardless of which storefront took it, so
 * the credit links to THEIR shop rather than to a profile page of ours.
 *
 * 🔑 An UNVERIFIED custom domain is not a link. `custom_domain` is whatever the
 * partner typed into the connect form; until verification says the DNS is
 * ours, linking it points a buyer at a host we do not control. The provisioned
 * subdomain is always ours, so it is the fallback rather than the second
 * choice.
 */
export function producerStorefrontUrl(partner: any): string | null {
  const host = partner?.custom_domain_verified
    ? partner?.custom_domain || partner?.storefront_domain
    : partner?.storefront_domain

  const clean = String(host ?? "").trim().toLowerCase()
  if (!clean) return null
  // Stored as a bare host; a scheme in the column would otherwise double up.
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean
  return `https://${clean}`
}

/**
 * PURE. True only when we positively know the viewer is somewhere OTHER than
 * the producing partner's own storefront. Unknown on either side ⇒ false.
 */
export function shouldNameProducer(
  viewerSalesChannelIds: string[] | null | undefined,
  partnerSalesChannelIds: string[] | null | undefined
): boolean {
  const viewer = (viewerSalesChannelIds ?? []).filter(Boolean)
  const partner = (partnerSalesChannelIds ?? []).filter(Boolean)
  if (!viewer.length || !partner.length) return false
  return !viewer.some((id) => partner.includes(id))
}

/**
 * Resolve the producing partner, or null when the band should not render.
 *
 * Never throws: a credit line has no business turning a buyer's quote page
 * into a 500. Every failure — no partner, no channel, same channel, a query
 * that fell over — collapses to the same "say nothing".
 */
export async function resolveQuoteProducer(
  scope: any,
  input: {
    partner_id?: string | null
    viewer_sales_channel_ids?: string[] | null
    /** The catalogue's words for what is in this basket. */
    product_tags?: string[] | null
  }
): Promise<QuoteProducer | null> {
  if (!input.partner_id) return null
  if (!(input.viewer_sales_channel_ids ?? []).length) return null

  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    // Filtered by id. An unfiltered partner read on a public, unauthenticated
    // route is how one dangling key took every storefront down (#1397).
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "handle",
        "logo",
        "country_code",
        "is_verified",
        "status",
        "workspace_type",
        "custom_domain",
        "custom_domain_verified",
        "storefront_domain",
        "stores.default_sales_channel_id",
      ],
      filters: { id: input.partner_id },
    })

    const partner = ((partners ?? []) as any[])[0]
    if (!partner) return null
    // An inactive partner is not a credential to show a buyer.
    if (partner.status && partner.status !== "active") return null

    const partnerChannels = ((partner.stores ?? []) as any[])
      .map((s) => s?.default_sales_channel_id)
      .filter(Boolean)

    if (!shouldNameProducer(input.viewer_sales_channel_ids, partnerChannels)) {
      return null
    }

    return {
      id: partner.id,
      name: partner.name ?? null,
      handle: partner.handle ?? null,
      logo: partner.logo ?? null,
      country_code: partner.country_code ?? null,
      is_verified: Boolean(partner.is_verified),
      url: producerStorefrontUrl(partner),
      // Filled by the caller: the story lives in the provenance resolver, and
      // resolving it a second time here would be a second answer to one
      // question. Null until then, never a placeholder.
      story: null,
      tags: composeProducerTags({
        workspace_type: partner.workspace_type ?? null,
        is_verified: Boolean(partner.is_verified),
        country_code: partner.country_code ?? null,
        product_tags: input.product_tags ?? null,
      }),
    }
  } catch {
    return null
  }
}
