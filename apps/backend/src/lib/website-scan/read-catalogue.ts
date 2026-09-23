/**
 * Read a partner's catalogue off their website (#2249).
 *
 * Typed feeds first, because they cannot be misread:
 *   1. Shopify `/products.json` (product_type, tags, images, published_at).
 *   2. WooCommerce's public Store API `/wp-json/wc/store/v1/products`.
 * Anything else is read from pages: the entry page, a handful of same-origin
 * catalogue links, and product pages found in `/sitemap.xml` — each read for
 * schema.org `Product` JSON-LD, or a product page's own Open Graph card. The
 * goal is evidence of what they make, not a mirror of their site.
 *
 * 🔴 Demo content is dropped. A WordPress theme ships sample products ("Woo
 * Single #2", lorem ipsum) that a fresh store never deletes — asal.in still
 * serves them — and filing those would give a partner capabilities it has
 * never shown us.
 */
import { safeFetch, parseScanUrl } from "./safe-fetch"
import type { ScannedCatalogue, ScannedProduct } from "./types"

const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024
const SHOPIFY_PAGE_SIZE = 250
const SHOPIFY_MAX_PAGES = 2
const MAX_EXTRA_PAGES = 4
const MAX_IMAGES_PER_PRODUCT = 3
const MAX_PAGE_TEXT = 6000
const MAX_SITEMAP_PRODUCT_PAGES = 24
const MAX_CHILD_SITEMAPS = 3
const PAGE_CONCURRENCY = 4
const WOO_PAGE_SIZE = 100

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
}

/**
 * ONE pass, so each entity is decoded exactly once. Chained replaces decode
 * `&amp;lt;` to `&lt;` and then to `<` — a double unescape (CodeQL
 * js/double-escaping on #2250).
 */
export const decodeEntities = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })

/** HTML → readable text. Scripts, styles and tags go; whitespace collapses. */
export const htmlToText = (html: string): string =>
  decodeEntities(
    String(html ?? "")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()

const absolutize = (src: unknown, base: string): string | null => {
  if (typeof src !== "string" || !src.trim()) return null
  try {
    const u = new URL(src.trim().startsWith("//") ? `https:${src.trim()}` : src.trim(), base)
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ─── Shopify ────────────────────────────────────────────────────────────────

export const mapShopifyProducts = (
  raw: any[],
  origin: string
): ScannedProduct[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((p) => p && typeof p.title === "string" && p.title.trim())
    .map((p) => ({
      title: p.title.trim(),
      product_type:
        typeof p.product_type === "string" && p.product_type.trim()
          ? p.product_type.trim()
          : null,
      tags: (Array.isArray(p.tags)
        ? p.tags
        : typeof p.tags === "string"
          ? p.tags.split(",")
          : []
      )
        .map((t: unknown) => String(t).trim())
        .filter(Boolean),
      description: clip(htmlToText(p.body_html ?? ""), 600),
      images: (Array.isArray(p.images) ? p.images : [])
        .map((img: any) => absolutize(img?.src, origin))
        .filter((u: string | null): u is string => !!u)
        .slice(0, MAX_IMAGES_PER_PRODUCT),
      url: p.handle ? `${origin}/products/${encodeURIComponent(p.handle)}` : null,
      published_at: p.published_at ?? p.created_at ?? null,
    }))

const tryShopify = async (origin: string): Promise<ScannedProduct[] | null> => {
  const products: ScannedProduct[] = []
  for (let page = 1; page <= SHOPIFY_MAX_PAGES; page++) {
    let res
    try {
      res = await safeFetch(
        `${origin}/products.json?limit=${SHOPIFY_PAGE_SIZE}&page=${page}`,
        { maxBytes: MAX_JSON_BYTES, accept: "application/json" }
      )
    } catch (e) {
      // A guard refusal is not "not Shopify" — let it surface.
      if ((e as Error)?.name === "UnsafeUrlError") throw e
      return page === 1 ? null : products
    }
    if (res.status !== 200 || !/json/i.test(res.contentType)) {
      return page === 1 ? null : products
    }
    let parsed: any
    try {
      parsed = JSON.parse(res.body.toString("utf8"))
    } catch {
      return page === 1 ? null : products
    }
    if (!Array.isArray(parsed?.products)) return page === 1 ? null : products
    const mapped = mapShopifyProducts(parsed.products, origin)
    products.push(...mapped)
    if (parsed.products.length < SHOPIFY_PAGE_SIZE) break
  }
  return products
}

// ─── Demo content ───────────────────────────────────────────────────────────

const DEMO_TITLE =
  /^(woo (single|album|logo|ninja)|ship your idea|happy ninja|ninja silhouette|premium quality|flying ninja|patient ninja|sample product|test product|product \d+)\b/i
const DEMO_TEXT = /lorem ipsum|pellentesque|consectetur adipiscing/i

/** True for a theme's placeholder product — never evidence of anything. */
export const isDemoProduct = (p: ScannedProduct): boolean =>
  DEMO_TITLE.test(p.title) || DEMO_TEXT.test(p.description) || DEMO_TEXT.test(p.title)

// ─── WooCommerce ────────────────────────────────────────────────────────────

export const mapWooProducts = (raw: any[], origin: string): ScannedProduct[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((p) => p && typeof p.name === "string" && p.name.trim())
    .map((p) => ({
      title: decodeEntities(p.name.trim()),
      product_type:
        (Array.isArray(p.categories) && p.categories[0]?.name
          ? decodeEntities(String(p.categories[0].name))
          : null),
      tags: [
        ...(Array.isArray(p.tags) ? p.tags : []),
        ...(Array.isArray(p.categories) ? p.categories.slice(1) : []),
      ]
        .map((t: any) => decodeEntities(String(t?.name ?? "")).trim())
        .filter(Boolean),
      description: clip(htmlToText(p.short_description || p.description || ""), 600),
      images: (Array.isArray(p.images) ? p.images : [])
        .map((img: any) => absolutize(img?.src, origin))
        .filter((u: string | null): u is string => !!u)
        .slice(0, MAX_IMAGES_PER_PRODUCT),
      url: absolutize(p.permalink, origin),
      // The Store API exposes no publish date.
      published_at: null,
    }))

const tryWooCommerce = async (origin: string): Promise<ScannedProduct[] | null> => {
  let res
  try {
    res = await safeFetch(`${origin}/wp-json/wc/store/v1/products?per_page=${WOO_PAGE_SIZE}`, {
      maxBytes: MAX_JSON_BYTES,
      accept: "application/json",
    })
  } catch (e) {
    if ((e as Error)?.name === "UnsafeUrlError") throw e
    return null
  }
  if (res.status !== 200 || !/json/i.test(res.contentType)) return null
  try {
    const parsed = JSON.parse(res.body.toString("utf8"))
    return Array.isArray(parsed) ? mapWooProducts(parsed, origin) : null
  } catch {
    return null
  }
}

// ─── Sitemap ────────────────────────────────────────────────────────────────

const PRODUCT_PATH = /\/(products?|shop|item|catalog(ue)?)\/[^/]+\/?$/i

/** `<loc>` values from a urlset or sitemapindex. */
export const sitemapLocs = (xml: string): { kind: "index" | "urlset"; locs: string[] } => {
  const locs = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    decodeEntities(m[1])
  )
  return { kind: /<sitemapindex/i.test(xml) ? "index" : "urlset", locs }
}

const fetchXml = async (url: string): Promise<string | null> => {
  try {
    const res = await safeFetch(url, { maxBytes: MAX_HTML_BYTES, accept: "application/xml,text/xml" })
    return res.status === 200 && /xml/i.test(res.contentType) ? res.body.toString("utf8") : null
  } catch (e) {
    if ((e as Error)?.name === "UnsafeUrlError") throw e
    return null
  }
}

/** Same-origin product-page URLs from /sitemap.xml, following one index level. */
export const sitemapProductUrls = async (origin: string): Promise<string[]> => {
  const root = await fetchXml(`${origin}/sitemap.xml`)
  if (!root) return []
  let { kind, locs } = sitemapLocs(root)
  if (kind === "index") {
    // Product sitemaps first: "product-sitemap.xml", "sitemap-products-1.xml".
    const children = [...locs].sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)))
    locs = []
    for (const child of children.slice(0, MAX_CHILD_SITEMAPS)) {
      if (!sameOrigin(child, origin)) continue
      const xml = await fetchXml(child)
      if (xml) locs.push(...sitemapLocs(xml).locs)
    }
  }
  const seen = new Set<string>()
  return locs
    .filter((u) => sameOrigin(u, origin) && PRODUCT_PATH.test(new URL(u).pathname))
    // Regional storefronts list every product once per region (/us/products/x,
    // /in/products/x); one copy is evidence enough.
    .filter((u) => {
      const tail = new URL(u).pathname.replace(/^\/[a-z]{2}(?=\/)/i, "")
      if (seen.has(tail)) return false
      seen.add(tail)
      return true
    })
    .slice(0, MAX_SITEMAP_PRODUCT_PAGES)
}

const sameOrigin = (u: string, origin: string) => {
  try {
    // www. and the apex are the same shop.
    const strip = (h: string) => h.replace(/^www\./i, "")
    return strip(new URL(u).hostname) === strip(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** Run `fn` over `items`, at most `n` at a time. */
const mapLimit = async <T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

// ─── HTML ───────────────────────────────────────────────────────────────────

const collectJsonLd = (html: string): any[] => {
  const out: any[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const walk = (node: any) => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(walk)
        out.push(node)
        if (Array.isArray(node["@graph"])) node["@graph"].forEach(walk)
        if (Array.isArray(node.itemListElement)) {
          node.itemListElement.forEach((el: any) => walk(el?.item ?? el))
        }
      }
      walk(parsed)
    } catch {
      /* malformed JSON-LD is common; skip the block */
    }
  }
  return out
}

const isProductNode = (n: any) => {
  const t = n?.["@type"]
  return Array.isArray(t) ? t.includes("Product") : t === "Product"
}

export const extractJsonLdProducts = (
  html: string,
  pageUrl: string
): ScannedProduct[] =>
  collectJsonLd(html)
    .filter(isProductNode)
    .filter((n) => typeof n.name === "string" && n.name.trim())
    .map((n) => {
      const images = (Array.isArray(n.image) ? n.image : [n.image])
        .map((img: any) => absolutize(typeof img === "string" ? img : img?.url, pageUrl))
        .filter((u: string | null): u is string => !!u)
        .slice(0, MAX_IMAGES_PER_PRODUCT)
      const material =
        typeof n.material === "string" ? n.material : null
      return {
        title: n.name.trim(),
        product_type: typeof n.category === "string" ? n.category.trim() : null,
        tags: material ? [material] : [],
        description: clip(htmlToText(String(n.description ?? "")), 600),
        images,
        url: absolutize(n.url, pageUrl) ?? pageUrl,
        published_at:
          typeof n.releaseDate === "string"
            ? n.releaseDate
            : typeof n.datePublished === "string"
              ? n.datePublished
              : null,
      }
    })

const metaContent = (html: string, prop: string): string | null => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
    "i"
  )
  const m = html.match(re)
  return m ? decodeEntities(m[1] ?? m[2]) : null
}

/**
 * A PRODUCT page's own Open Graph card. Only for pages found as products (a
 * sitemap product URL): the homepage's card describes the shop, and treating
 * it as a product is how a site came out as one product titled "Store".
 */
export const productFromOgCard = (html: string, pageUrl: string): ScannedProduct | null => {
  const title = metaContent(html, "og:title")
  const image = absolutize(metaContent(html, "og:image"), pageUrl)
  const ogType = metaContent(html, "og:type")
  if (!title || !image || (ogType && !/product|og:product/i.test(ogType) && ogType !== "website")) {
    return null
  }
  return {
    title: title.trim(),
    product_type: null,
    tags: [],
    description: clip(metaContent(html, "og:description") ?? "", 600),
    images: [image],
    url: pageUrl,
    published_at: null,
  }
}

/** A same-origin page that looks like part of the catalogue. */
export const catalogueLinks = (html: string, pageUrl: string): string[] => {
  const origin = new URL(pageUrl).origin
  const seen = new Set<string>()
  const re = /<a[^>]+href=["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], pageUrl)
    if (!abs) continue
    const u = new URL(abs)
    if (u.origin !== origin) continue
    if (!/(product|collection|shop|catalog|store|saree|shawl|stole|fabric)/i.test(u.pathname)) continue
    u.search = ""
    seen.add(u.toString())
  }
  seen.delete(pageUrl)
  return [...seen].slice(0, MAX_EXTRA_PAGES)
}

const readHtmlPage = async (url: string) => {
  const res = await safeFetch(url, {
    maxBytes: MAX_HTML_BYTES,
    accept: "text/html,application/xhtml+xml",
  })
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}`)
  if (!/html/i.test(res.contentType)) {
    throw new Error(`${url} is not an HTML page (${res.contentType || "no type"})`)
  }
  return { url: res.url, html: res.body.toString("utf8") }
}

const dedupeProducts = (products: ScannedProduct[]) => {
  const seen = new Set<string>()
  return products.filter((p) => {
    const k = `${p.title.toLowerCase()}|${p.url ?? ""}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export const readPartnerCatalogue = async (
  rawUrl: string
): Promise<ScannedCatalogue> => {
  const start = parseScanUrl(rawUrl)
  const warnings: string[] = []

  // The operator may paste a product page; the catalogue lives at the origin.
  const shopify = await tryShopify(start.origin)

  let first: { url: string; html: string } | null = null
  try {
    first = await readHtmlPage(start.toString())
  } catch (e) {
    if ((e as Error)?.name === "UnsafeUrlError") throw e
    if (!shopify?.length) throw e
    warnings.push(`Could not read ${start.toString()}: ${(e as Error).message}`)
  }

  const origin = first ? new URL(first.url).origin : start.origin
  const pageText = first
    ? clip(
        [metaContent(first.html, "og:description") ?? metaContent(first.html, "description"), htmlToText(first.html)]
          .filter(Boolean)
          .join("\n"),
        MAX_PAGE_TEXT
      )
    : ""

  const finish = (platform: "shopify" | "html", products: ScannedProduct[]): ScannedCatalogue => {
    const real = dedupeProducts(products).filter((p) => !isDemoProduct(p))
    const dropped = products.length - real.length
    if (dropped > 0 && real.length < products.length) {
      const demo = products.filter(isDemoProduct).length
      if (demo) warnings.push(`Ignored ${demo} theme demo product(s) (placeholder names or lorem ipsum)`)
    }
    if (!real.length) {
      warnings.push("No products found on the site — only site text was read, so nothing can be evidenced by a photo")
    }
    return { platform, origin, products: real, page_text: pageText, warnings }
  }

  if (shopify?.length) return finish("shopify", shopify)
  if (shopify && !shopify.length) warnings.push("Shopify store with no published products")

  // A Woo store holding only its theme's demo rows is not a catalogue: note
  // them and keep reading the pages, where the real products may live.
  const woo = await tryWooCommerce(origin)
  const wooDemo = (woo ?? []).filter(isDemoProduct).length
  if (woo && woo.length > wooDemo) return finish("html", woo)
  if (wooDemo) warnings.push(`Ignored ${wooDemo} theme demo product(s) (placeholder names or lorem ipsum)`)

  const products: ScannedProduct[] = first ? extractJsonLdProducts(first.html, first.url) : []
  if (first) {
    for (const link of catalogueLinks(first.html, first.url)) {
      try {
        const page = await readHtmlPage(link)
        products.push(...extractJsonLdProducts(page.html, page.url))
      } catch (e) {
        if ((e as Error)?.name === "UnsafeUrlError") throw e
        warnings.push(`Skipped ${link}: ${(e as Error).message}`)
      }
    }
  }

  // Product pages the entry page did not link to — most of a JS-rendered
  // storefront's catalogue is only reachable this way.
  const known = new Set(products.map((p) => p.url))
  const productPages = (await sitemapProductUrls(origin)).filter((u) => !known.has(u))
  let unreadable = 0
  const fromPages = await mapLimit(productPages, PAGE_CONCURRENCY, async (url) => {
    try {
      const page = await readHtmlPage(url)
      const ld = extractJsonLdProducts(page.html, page.url)
      if (ld.length) return ld
      const card = productFromOgCard(page.html, page.url)
      return card ? [card] : []
    } catch (e) {
      if ((e as Error)?.name === "UnsafeUrlError") throw e
      unreadable++
      return []
    }
  })
  products.push(...fromPages.flat())
  if (unreadable) warnings.push(`${unreadable} product page(s) from the sitemap could not be read`)

  return finish("html", products)
}
