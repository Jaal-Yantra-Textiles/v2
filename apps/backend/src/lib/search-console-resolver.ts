import { SOCIALS_MODULE } from "../modules/socials"
import { WEBSITE_MODULE } from "../modules/website"

/**
 * Find the Google Search Console binding that covers a given website's
 * domain. GSC stores `siteUrl` in two flavours and a website's domain
 * field is a bare hostname, so the matcher has to consider every plausible
 * form.
 *
 * Given a website with `domain = "cicilabel.com"`, this matches against
 * bindings whose `resource_id` is any of:
 *   - "https://cicilabel.com/"        (URL-prefix property, https)
 *   - "http://cicilabel.com/"         (URL-prefix property, http — rare)
 *   - "https://www.cicilabel.com/"    (URL-prefix with www)
 *   - "sc-domain:cicilabel.com"       (Domain property — covers all subdomains)
 *
 * If a website's domain is itself a subdomain (e.g. "shop.example.com"),
 * the sc-domain property for the parent ("sc-domain:example.com") is also
 * considered a valid match — Domain properties cover everything below.
 *
 * Returns the first match found, or null if the website has no GSC
 * property bound on any platform.
 */
export type SearchConsoleBinding = {
  binding_id: string
  platform_id: string
  resource_id: string // the site_url as stored on the binding
  matched_via: "url_prefix" | "url_prefix_www" | "sc_domain" | "sc_domain_parent"
}

export async function resolveSearchConsoleBindingForWebsite(
  scope: any,
  websiteId: string
): Promise<{
  website: { id: string; domain: string; name: string } | null
  binding: SearchConsoleBinding | null
  candidates: string[]
}> {
  const websiteService = scope.resolve(WEBSITE_MODULE) as any
  const socials = scope.resolve(SOCIALS_MODULE) as any

  const [website] = await websiteService.listWebsites(
    { id: websiteId },
    { take: 1 }
  )
  if (!website) {
    return { website: null, binding: null, candidates: [] }
  }

  const domain = String(website.domain || "").trim().toLowerCase()
  if (!domain) {
    return {
      website: { id: website.id, domain: "", name: website.name || "" },
      binding: null,
      candidates: [],
    }
  }

  const candidates = buildSearchConsoleCandidates(domain)

  // Single query — any of the candidate site_urls. We don't filter by
  // platform_id because we don't know which platform the operator bound
  // the GSC property under; we just want the first match.
  const bindings = await socials.listSocialPlatformBindings({
    service: "search-console",
    resource_id: candidates.map((c) => c.value),
  })

  if (!bindings?.length) {
    return {
      website: { id: website.id, domain, name: website.name || "" },
      binding: null,
      candidates: candidates.map((c) => c.value),
    }
  }

  // Pick the most specific match. URL-prefix is more specific than
  // sc-domain (which can cover unrelated subdomains too).
  const ordered = candidates
    .map((c) => bindings.find((b: any) => b.resource_id === c.value && c))
    .filter(Boolean) as any[]
  const winner = ordered[0] || bindings[0]
  const matchedCandidate = candidates.find(
    (c) => c.value === winner.resource_id
  )

  return {
    website: { id: website.id, domain, name: website.name || "" },
    binding: {
      binding_id: winner.id,
      platform_id: winner.platform_id,
      resource_id: winner.resource_id,
      matched_via: matchedCandidate?.kind || "url_prefix",
    },
    candidates: candidates.map((c) => c.value),
  }
}

type Candidate = {
  value: string
  kind: SearchConsoleBinding["matched_via"]
}

/**
 * Generate the plausible Search Console site_url forms for a given bare
 * domain. Ordered by specificity — exact URL-prefix first, parent-domain
 * fallback last. The matcher returns the first hit, so this order is
 * load-bearing.
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

  // sc-domain on the exact hostname
  out.push({ value: `sc-domain:${d}`, kind: "sc_domain" })

  // sc-domain on the parent — e.g. shop.example.com → sc-domain:example.com.
  // Stop at the second-level domain to avoid matching on TLDs.
  const parts = d.split(".")
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".")
    out.push({ value: `sc-domain:${parent}`, kind: "sc_domain_parent" })
  }

  return out
}
