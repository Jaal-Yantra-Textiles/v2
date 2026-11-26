import { test, expect } from "@playwright/test"

import { assertNotVercelCheckpoint } from "../helpers/vercel-checkpoint"

/**
 * Homepage metadata on a partner storefront.
 *
 * The root layout already resolves the tenant's store name, tagline and
 * favicon from the theme, but the homepage's own `generateMetadata` overrode
 * that with `NEXT_PUBLIC_STORE_NAME || "Store"` and a hardcoded blurb. So a
 * storefront whose theme said "Unique Pashmina" served:
 *
 *     <title>Store | Unique Pashmina</title>
 *     <meta name="description" content="Shop handmade, locally sourced, …">
 *     <meta property="og:title" content="Store">
 *
 * Every partner site shared the starter's boilerplate to social, and ranked on
 * a page titled "Store". The bug was invisible from the theme editor — saving
 * worked, the values were stored, nothing rendered them.
 *
 * The assertions compare the page against THAT TENANT'S theme fetched from the
 * backend, never against literal strings. A test hardcoding "Unique Pashmina"
 * would pass for one partner and lie for the rest, and would have to be edited
 * every time a partner rewrites their copy — the point is that the page shows
 * whatever the partner set.
 *
 * Where it runs:
 *
 *  - CI (default): the storefront-starter submodule built and started on
 *    :8000 against the e2e backend, as the tenant `e2e-storefront-seed.ts`
 *    creates (website row for `localhost`). Tagged `@localstack`, so the admin
 *    run skips it; playwright.storefront.config.ts boots both servers when
 *    E2E_LOCAL_STACK=1. Until 2026-11-22 this read a live partner site, and
 *    went red the day Vercel Bot Protection started answering GitHub runners
 *    with HTTP 429 "Vercel Security Checkpoint".
 *  - Live (opt-in): STOREFRONT_LIVE=1 points it at www.uniquepashmina.com and
 *    tags it `@live` instead. Override either URL to check another partner:
 *
 *   STOREFRONT_LIVE=1 STOREFRONT_HOME_URL=https://…/in \
 *     pnpm exec playwright test -c e2e/playwright.storefront.config.ts
 */

const LIVE = !!process.env.STOREFRONT_LIVE

const HOME_URL =
  process.env.STOREFRONT_HOME_URL ??
  (LIVE ? "https://www.uniquepashmina.com/au" : "http://localhost:8000/in")

const BACKEND_URL =
  process.env.STOREFRONT_BACKEND_URL ??
  (LIVE ? "https://v3.jaalyantra.com" : "http://localhost:9000")

type Theme = {
  branding?: { store_name?: string; tagline?: string; favicon_url?: string }
  hero?: { title?: string; description?: string; background_image_url?: string }
}

/**
 * The domain the backend keys the website row by: the hostname, minus `www.`.
 * Hostname, not host: the storefront strips the port before it looks the
 * tenant up, so http://localhost:8000 is the row for `localhost`.
 */
const domainOf = (url: string) => new URL(url).hostname.replace(/^www\./, "")

test.describe(`Storefront homepage metadata @storefront ${LIVE ? "@live" : "@localstack"}`, () => {
  let theme: Theme

  test.beforeAll(async ({ request }) => {
    const res = await request.get(
      `${BACKEND_URL}/web/website/${domainOf(HOME_URL)}`
    )
    expect(
      res.ok(),
      `backend did not serve a website row for ${domainOf(HOME_URL)} — ` +
        `without it there is nothing to compare the page against`
    ).toBeTruthy()
    const body = await res.json()
    theme = (body.website ?? body).theme ?? {}
  })

  test.beforeEach(async ({ page }) => {
    const response = await page.goto(HOME_URL, { waitUntil: "domcontentloaded" })
    await assertNotVercelCheckpoint(page, response)
  })

  test("the title carries the partner's store name, not the starter default", async ({
    page,
  }) => {
    const storeName = theme.branding?.store_name
    test.skip(!storeName, "tenant has not set branding.store_name")

    const title = await page.title()

    expect(
      title,
      `<title> is "${title}" — the homepage should be titled with the store ` +
        `name from the theme ("${storeName}")`
    ).toContain(storeName!)

    // "Store" is the env fallback. Seeing it next to a real store name means
    // the page-level metadata ignored the theme and the layout template then
    // appended the brand — the exact "Store | Unique Pashmina" shape.
    expect(
      title,
      `<title> is "${title}" — a leading "Store" means generateMetadata fell ` +
        `back to NEXT_PUBLIC_STORE_NAME instead of reading the theme`
    ).not.toMatch(/^Store\b/)
  })

  test("the description is the partner's copy, not the starter's boilerplate", async ({
    page,
  }) => {
    const expected = theme.hero?.description || theme.branding?.tagline
    test.skip(!expected, "tenant has set neither hero.description nor tagline")

    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content")

    expect(
      description,
      `meta description is "${description}" — it should be the partner's own ` +
        `copy from the theme`
    ).toBe(expected)
  })

  test("open graph shares the partner's brand and hero image", async ({
    page,
  }) => {
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content")

    expect(
      ogTitle,
      `og:title is "${ogTitle}" — social cards were sharing the literal word ` +
        `"Store" for every partner storefront`
    ).not.toBe("Store")

    const heroImage = theme.hero?.background_image_url
    if (heroImage) {
      const ogImage = await page
        .locator('meta[property="og:image"]')
        .getAttribute("content")
      expect(
        ogImage,
        `og:image is "${ogImage}" — when the partner has chosen a hero image ` +
          `that is what a shared link should preview`
      ).toBe(heroImage)
    }
  })

  test("a favicon is served when the tenant has set one", async ({ page }) => {
    const faviconUrl = theme.branding?.favicon_url
    test.skip(
      !faviconUrl,
      "tenant has not set branding.favicon_url — nothing to render"
    )

    const icon = page.locator('link[rel="icon"]')
    await expect(
      icon,
      `no <link rel="icon"> in <head> though the theme sets favicon_url`
    ).toHaveCount(1)
    await expect(icon).toHaveAttribute("href", faviconUrl!)
  })
})
