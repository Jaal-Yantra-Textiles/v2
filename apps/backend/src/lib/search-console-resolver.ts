import { SOCIALS_MODULE } from "../modules/socials"
import { WEBSITE_MODULE } from "../modules/website"

/**
 * Find the Google Search Console binding that covers a given website's
 * domain. GSC stores `siteUrl` in two flavours and a website's domain
 * field is a bare hostname, so the matcher has to consider every plausible
 * form.
 *
 * Matching is scoped to the website's *own* identity: its canonical
 * `website.domain` plus every alias in the `website_domain` table (custom
 * domains, marketing aliases). For each such hostname we consider bindings
 * whose `resource_id` is any of:
 *   - "https://cicilabel.com/"        (URL-prefix property, https)
 *   - "http://cicilabel.com/"         (URL-prefix property, http — rare)
 *   - "https://www.cicilabel.com/"    (URL-prefix with www)
 *   - "sc-domain:cicilabel.com"       (Domain property — covers all subdomains)
 *
 * We deliberately do NOT auto-widen a subdomain to its parent registrable
 * domain (e.g. "shop.example.com" → "sc-domain:example.com"). A parent
 * Domain property is shared by every sibling subdomain, so auto-matching it
 * leaks one website's Search Console data onto unrelated websites. If an
 * operator genuinely wants a subdomain site to read from the parent Domain
 * property, they express that explicitly by adding the parent hostname
 * (e.g. "example.com") as an alias in the `website_domain` table — which
 * produces the "sc-domain:example.com" candidate here.
 *
 * Returns the most specific match found, or null if the website has no GSC
 * property bound to any of its domains on any platform.
 */
export type SearchConsoleBinding = {
  binding_id: string
  platform_id: string
  resource_id: string // the site_url as stored on the binding
  matched_via: "url_prefix" | "url_prefix_www" | "sc_domain"
}

export async function resolveSearchConsoleBindingForWebsite(
  scope: any,
  websiteId: string
): Promise<{
  website: { id: string; domain: string; name: string } | null
  binding: SearchConsoleBinding | null
  /**
   * Every GSC property that matches this website's domain or aliases,
   * ordered most-specific-first. `binding` is `bindings[0]`. Callers that
   * only need the primary property can keep using `binding`; the console UI
   * uses this to list all available properties for the domain.
   */
  bindings: SearchConsoleBinding[]
  candidates: string[]
}> {
  const websiteService = scope.resolve(WEBSITE_MODULE) as any
  const socials = scope.resolve(SOCIALS_MODULE) as any

  const [website] = await websiteService.listWebsites(
    { id: websiteId },
    { take: 1 }
  )
  if (!website) {
    return { website: null, binding: null, bindings: [], candidates: [] }
  }

  const primaryDomain = String(website.domain || "").trim().toLowerCase()

  // Gather the website's own identity: primary domain + every alias
  // registered against it in the website_domain table.
  const aliasRows = await websiteService
    .listWebsiteDomains({ website_id: websiteId })
    .catch(() => [] as any[])

  const hostnames = new Set<string>()
  if (primaryDomain) hostnames.add(primaryDomain)
  for (const row of aliasRows || []) {
    const d = String(row?.domain || "").trim().toLowerCase()
    if (d) hostnames.add(d)
  }

  if (hostnames.size === 0) {
    return {
      website: { id: website.id, domain: "", name: website.name || "" },
      binding: null,
      bindings: [],
      candidates: [],
    }
  }

  // Build candidates for every hostname, ordered by specificity. Dedupe by
  // value while keeping the most specific `kind` for each site_url.
  const candidateMap = new Map<string, Candidate>()
  for (const host of hostnames) {
    for (const c of buildSearchConsoleCandidates(host)) {
      if (!candidateMap.has(c.value)) candidateMap.set(c.value, c)
    }
  }
  const candidates = [...candidateMap.values()]

  // Single query — any of the candidate site_urls. We don't filter by
  // platform_id because we don't know which platform the operator bound
  // the GSC property under; we just want the first match.
  const bindings = await socials.listSocialPlatformBindings({
    service: "search-console",
    resource_id: candidates.map((c) => c.value),
  })

  if (!bindings?.length) {
    return {
      website: { id: website.id, domain: primaryDomain, name: website.name || "" },
      binding: null,
      bindings: [],
      candidates: candidates.map((c) => c.value),
    }
  }

  // Resolve every matching property, ordered most-specific-first. URL-prefix
  // is more specific than sc-domain (which can cover unrelated subdomains
  // too); `candidates` is already ordered specificity-first, so walking it in
  // order yields the properties in that order. We only ever match on this
  // website's own domains/aliases, so there is no cross-website fallback.
  const matched: SearchConsoleBinding[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const b = bindings.find((x: any) => x.resource_id === c.value)
    if (b && !seen.has(b.id)) {
      seen.add(b.id)
      matched.push({
        binding_id: b.id,
        platform_id: b.platform_id,
        resource_id: b.resource_id,
        matched_via: c.kind,
      })
    }
  }

  return {
    website: { id: website.id, domain: primaryDomain, name: website.name || "" },
    binding: matched[0] || null,
    bindings: matched,
    candidates: candidates.map((c) => c.value),
  }
}

type Candidate = {
  value: string
  kind: SearchConsoleBinding["matched_via"]
}

/**
 * Generate the plausible Search Console site_url forms for a given bare
 * domain. Ordered by specificity — exact URL-prefix first, sc-domain on the
 * exact hostname last. The matcher returns the first hit, so this order is
 * load-bearing.
 *
 * Note: this generates candidates for the *exact* hostname only. Parent
 * registrable domains are intentionally not derived here — see the note on
 * `resolveSearchConsoleBindingForWebsite`. Aliases opt into parent Domain
 * properties explicitly.
 */
export function buildSearchConsoleCandidates(domain: string): Candidate[] {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const out: Candidate[] = [
    { value: `https://${d}/`, kind: "url_prefix" },
    { value: `http://${d}/`, kind: "url_prefix" },
  ]

  // Add www. variants only when the input doesn't already include www.
  if (!d.startsWith("www.")) {
    out.push({ value: `https://www.${d}/`, kind: "url_prefix_www" })
    out.push({ value: `http://www.${d}/`, kind: "url_prefix_www" })
  }

  // sc-domain on the exact hostname (covers subdomains *below* this host).
  out.push({ value: `sc-domain:${d}`, kind: "sc_domain" })

  return out
}
