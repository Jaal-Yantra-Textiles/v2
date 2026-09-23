import http from "node:http"
import type { AddressInfo } from "node:net"

import {
  catalogueLinks,
  extractJsonLdProducts,
  htmlToText,
  isDemoProduct,
  mapShopifyProducts,
  mapWooProducts,
  productFromOgCard,
  readPartnerCatalogue,
  sitemapLocs,
} from "../read-catalogue"
import type { ScannedProduct } from "../types"

const product = (over: Partial<ScannedProduct>): ScannedProduct => ({
  title: "x",
  product_type: null,
  tags: [],
  description: "",
  images: [],
  url: null,
  published_at: null,
  ...over,
})

describe("isDemoProduct", () => {
  it.each([
    ["Woo Single #2", ""],
    ["Happy Ninja", ""],
    ["Handwoven Stole", "Pellentesque habitant morbi tristique"],
    ["Lorem Ipsum Saree", ""],
  ])("drops theme placeholder %s", (title, description) => {
    expect(isDemoProduct(product({ title, description }))).toBe(true)
  })

  it("keeps a real product", () => {
    expect(isDemoProduct(product({ title: "Tangaliya Kala Cotton Suit", description: "Handwoven in Surendranagar" }))).toBe(false)
  })
})

describe("mapWooProducts", () => {
  it("reads name, first category as type, images and permalink", () => {
    const [p] = mapWooProducts(
      [{ name: "Jamdani &amp; Muslin", categories: [{ name: "Sarees" }, { name: "Silk" }], tags: [{ name: "handwoven" }], short_description: "<p>Bengal</p>", images: [{ src: "https://asal.example/j.jpg" }], permalink: "https://asal.example/product/j/" }],
      "https://asal.example"
    )
    expect(p).toMatchObject({
      title: "Jamdani & Muslin",
      product_type: "Sarees",
      tags: ["handwoven", "Silk"],
      description: "Bengal",
      images: ["https://asal.example/j.jpg"],
      url: "https://asal.example/product/j/",
      published_at: null,
    })
  })
})

describe("sitemapLocs", () => {
  it("tells an index from a urlset", () => {
    expect(sitemapLocs(`<sitemapindex><sitemap><loc>https://a/product-sitemap.xml</loc></sitemap></sitemapindex>`)).toEqual({ kind: "index", locs: ["https://a/product-sitemap.xml"] })
    expect(sitemapLocs(`<urlset><url><loc> https://a/products/x </loc></url></urlset>`).locs).toEqual(["https://a/products/x"])
  })
})

describe("productFromOgCard", () => {
  it("reads a product page's card", () => {
    const html = `<meta property="og:type" content="product"><meta property="og:title" content="Kani Shawl"><meta property="og:image" content="/k.jpg">`
    expect(productFromOgCard(html, "https://p.example/products/kani")).toMatchObject({ title: "Kani Shawl", images: ["https://p.example/k.jpg"] })
  })
  it("refuses an article's card", () => {
    const html = `<meta property="og:type" content="article"><meta property="og:title" content="Our story"><meta property="og:image" content="/s.jpg">`
    expect(productFromOgCard(html, "https://p.example/products/story")).toBeNull()
  })
})

describe("htmlToText", () => {
  it("drops scripts and styles and decodes entities", () => {
    expect(
      htmlToText(`<style>.a{}</style><p>Hand&nbsp;woven &amp; spun</p><script>alert(1)</script><p>Kutch</p>`)
    ).toBe("Hand woven & spun\n Kutch")
  })
})

describe("mapShopifyProducts", () => {
  it("keeps the typed fields and absolutises images", () => {
    const [p] = mapShopifyProducts(
      [
        {
          title: " Kala Cotton Stole ",
          handle: "kala-stole",
          product_type: "Stole",
          tags: ["handwoven", "natural dye"],
          body_html: "<p>Handwoven in <b>Kutch</b></p>",
          published_at: "2025-08-02T10:00:00+05:30",
          images: [{ src: "//cdn.shopify.com/a.jpg" }, { src: "https://cdn.shopify.com/b.jpg" }],
        },
      ],
      "https://shop.example"
    )
    expect(p).toEqual({
      title: "Kala Cotton Stole",
      product_type: "Stole",
      tags: ["handwoven", "natural dye"],
      description: "Handwoven in Kutch",
      images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
      url: "https://shop.example/products/kala-stole",
      published_at: "2025-08-02T10:00:00+05:30",
    })
  })

  it("accepts the comma-string tag form and skips untitled rows", () => {
    const out = mapShopifyProducts(
      [{ title: "", tags: "a" }, { title: "Saree", tags: "silk, jamdani" }],
      "https://s.example"
    )
    expect(out).toHaveLength(1)
    expect(out[0].tags).toEqual(["silk", "jamdani"])
    expect(out[0].product_type).toBeNull()
  })
})

describe("extractJsonLdProducts", () => {
  it("reads Product nodes, including inside @graph and ItemList", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"Product","name":"Muslin 150s","image":["/m.jpg"],"material":"cotton","url":"/p/muslin"}]}</script>
      <script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"item":{"@type":"Product","name":"Matka Silk","image":{"url":"https://img.example/k.jpg"}}}]}</script>
      <script type="application/ld+json">{ not json </script>`
    const out = extractJsonLdProducts(html, "https://gof.example/shop")
    expect(out.map((p) => p.title)).toEqual(["Muslin 150s", "Matka Silk"])
    expect(out[0].images).toEqual(["https://gof.example/m.jpg"])
    expect(out[0].tags).toEqual(["cotton"])
    expect(out[0].url).toBe("https://gof.example/p/muslin")
    expect(out[1].images).toEqual(["https://img.example/k.jpg"])
  })
})

describe("catalogueLinks", () => {
  it("keeps same-origin catalogue paths only", () => {
    const html = `<a href="/collections/sarees">x</a><a href="https://other.example/products/a">y</a><a href="/about">z</a><a href="/products/b?variant=1">w</a>`
    expect(catalogueLinks(html, "https://p.example/")).toEqual([
      "https://p.example/collections/sarees",
      "https://p.example/products/b",
    ])
  })
})

describe("readPartnerCatalogue", () => {
  let server: http.Server
  let shopify = true
  let woo: "off" | "demo" = "off"
  let base: string
  const OLD = process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS

  beforeAll(async () => {
    process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = "true"
    server = http.createServer((req, res) => {
      if (req.url?.startsWith("/products.json")) {
        if (!shopify) {
          res.writeHead(404, { "content-type": "text/html" })
          return res.end("<h1>not found</h1>")
        }
        res.writeHead(200, { "content-type": "application/json" })
        return res.end(
          JSON.stringify({
            products: [{ title: "Tussar Saree", handle: "tussar", product_type: "Saree", tags: ["tussar"], images: [{ src: "/t.jpg" }], published_at: "2025-09-15T00:00:00Z" }],
          })
        )
      }
      if (req.url?.startsWith("/wp-json/wc/store/v1/products")) {
        if (woo === "off") {
          res.writeHead(404, { "content-type": "text/html" })
          return res.end("nope")
        }
        res.writeHead(200, { "content-type": "application/json" })
        return res.end(JSON.stringify([{ name: "Woo Single #2", short_description: "Pellentesque habitant", images: [{ src: "/w.jpg" }] }]))
      }
      if (req.url === "/sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml" })
        return res.end(`<sitemapindex><sitemap><loc>${base}/pages-sitemap.xml</loc></sitemap><sitemap><loc>${base}/product-sitemap.xml</loc></sitemap></sitemapindex>`)
      }
      if (req.url === "/product-sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml" })
        return res.end(`<urlset><url><loc>${base}/us/products/tussar-dupatta</loc></url><url><loc>${base}/in/products/tussar-dupatta</loc></url><url><loc>https://elsewhere.example/products/x</loc></url></urlset>`)
      }
      if (req.url === "/us/products/tussar-dupatta") {
        res.writeHead(200, { "content-type": "text/html" })
        return res.end(`<meta property="og:type" content="product"><meta property="og:title" content="Tussar Dupatta"><meta property="og:image" content="/d.jpg">`)
      }
      if (req.url === "/" || req.url === "/home") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        return res.end(
          `<html><head><meta name="description" content="Handloom weavers of Bhagalpur"></head><body><a href="/collections/linen">Linen</a><p>We weave tussar.</p></body></html>`
        )
      }
      if (req.url === "/collections/linen") {
        res.writeHead(200, { "content-type": "text/html" })
        return res.end(`<script type="application/ld+json">{"@type":"Product","name":"Linen 30 lea","image":"/l.jpg"}</script>`)
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = OLD
    await new Promise((r) => server.close(r))
  })

  it("prefers the Shopify feed, reading from the ORIGIN even when given a sub-page", async () => {
    shopify = true
    const cat = await readPartnerCatalogue(`${base}/home`)
    expect(cat.platform).toBe("shopify")
    expect(cat.products.map((p) => p.title)).toEqual(["Tussar Saree"])
    expect(cat.products[0].images).toEqual([`${base}/t.jpg`])
    expect(cat.page_text).toContain("Handloom weavers of Bhagalpur")
  })

  it("falls back to linked pages AND sitemap product pages, once per product across regions", async () => {
    shopify = false
    woo = "off"
    const cat = await readPartnerCatalogue(`${base}/`)
    expect(cat.platform).toBe("html")
    expect(cat.products.map((p) => p.title)).toEqual(["Linen 30 lea", "Tussar Dupatta"])
    expect(cat.products[1].images).toEqual([`${base}/d.jpg`])
    // the homepage's own card is NOT a product
    expect(cat.products.some((p) => p.url === `${base}/`)).toBe(false)
  })

  it("drops a WooCommerce theme's demo products instead of filing them", async () => {
    shopify = false
    woo = "demo"
    const cat = await readPartnerCatalogue(`${base}/`)
    expect(cat.products.map((p) => p.title)).not.toContain("Woo Single #2")
    expect(cat.warnings.join()).toMatch(/Ignored 1 theme demo product/)
    // …and it kept reading the pages rather than stopping at an all-demo feed
    expect(cat.products.map((p) => p.title)).toEqual(["Linen 30 lea", "Tussar Dupatta"])
  })
})
