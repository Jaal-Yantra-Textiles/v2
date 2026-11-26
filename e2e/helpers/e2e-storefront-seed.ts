import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"
import * as fs from "fs"
import * as path from "path"
import * as zlib from "zlib"

import { upsertProductSpecWorkflow } from "../../apps/backend/src/workflows/products/upsert-product-spec"

/**
 * A partner storefront the CI e2e can render ON ITS OWN, so the storefront
 * specs stop depending on a live partner site.
 *
 * Until 2026-11-22 the homepage-metadata and product-layout specs read
 * www.uniquepashmina.com. Then the Vercel project turned on Bot Protection,
 * GitHub runners started getting HTTP 429 "Vercel Security Checkpoint", and
 * those five tests went red on every main push while the site was fine. A
 * check that depends on someone else's firewall is not a check.
 *
 * What this seeds is what those specs (and storefront-made-to-spec) read:
 *
 *  - a sales channel + publishable key: the storefront is started
 *    single-tenant with this key (playwright.storefront.config.ts reads it
 *    from SEED_FILE), so the catalogue it sees is exactly this channel's;
 *  - a website row for domain `localhost`: the storefront resolves its tenant
 *    from the request host with the port stripped, so a browser on
 *    http://localhost:8000 lands on THIS theme (store name, tagline, hero copy
 *    and hero image the metadata spec compares against);
 *  - `ikat-grid-patterns-blue-yellow`, the product the layout and made-to-spec
 *    specs open, with a description, two real images and an INR price, plus
 *    the same spec option groups as src/scripts/seed-ikat-spec-local.ts;
 *  - an INR region covering India, so /in resolves. It REUSES the
 *    "E2E Quote Region" that e2e-seed.ts creates (a country can belong to one
 *    region only) and creates it under that same name if this runs first, so
 *    admin-quote-drafts.spec.ts still finds it.
 *
 * Images are real PNGs written into apps/backend/static/, which the local file
 * provider serves at /static. A gallery of broken images would still have a
 * bounding box, and the layout spec would pass against a page no customer
 * would accept.
 *
 * Idempotent. Run after `pnpm e2e:seed`:
 *   cd apps/backend && pnpm e2e:seed:storefront
 */

export const STOREFRONT_SEED_FILE = path.resolve(
  __dirname,
  "../../apps/backend/.e2e-seed.storefront.json"
)

const DOMAIN = "localhost"
const HANDLE = "ikat-grid-patterns-blue-yellow"
const CHANNEL_NAME = "E2E Partner Storefront"
const KEY_TITLE = "E2E Partner Storefront key"
const BACKEND_URL =
  process.env.E2E_BACKEND_URL ||
  `http://localhost:${process.env.E2E_BACKEND_PORT || 9000}`

const THEME = {
  branding: {
    store_name: "Kashmir Loom House",
    tagline: "Hand-woven shawls from the Valley, made to order.",
  },
  hero: {
    title: "Woven to order",
    description:
      "Kashmir Loom House weaves every shawl after you order it: your pattern, your embroidery, on our looms in Srinagar.",
    background_image_url: `${BACKEND_URL}/static/e2e-storefront/hero.png`,
  },
}

/* ------------------------------------------------------------------------ */
/* A minimal PNG encoder: a solid-colour image with real dimensions.        */
/* ------------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function solidPng(width: number, height: number, rgb: [number, number, number]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function writeImages(): { hero: string; product: string[] } {
  const dir = path.resolve(__dirname, "../../apps/backend/static/e2e-storefront")
  fs.mkdirSync(dir, { recursive: true })
  const files: Array<[string, Buffer]> = [
    ["hero.png", solidPng(1200, 630, [32, 64, 96])],
    ["ikat-1.png", solidPng(800, 1000, [40, 70, 150])],
    ["ikat-2.png", solidPng(800, 1000, [220, 180, 40])],
  ]
  for (const [name, buf] of files) fs.writeFileSync(path.join(dir, name), buf)
  const url = (n: string) => `${BACKEND_URL}/static/e2e-storefront/${n}`
  return { hero: url("hero.png"), product: [url("ikat-1.png"), url("ikat-2.png")] }
}

/* ------------------------------------------------------------------------ */

async function ensureIndiaRegion(container: any): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })
  const india = (regions ?? []).find(
    (r: any) =>
      String(r.currency_code).toLowerCase() === "inr" &&
      (r.countries ?? []).some((c: any) => c?.iso_2 === "in")
  )
  if (india) return india.id

  // Same name and shape as e2e-seed.ts's seedQuoteRegion, which finds it by
  // name, so the order the two seeds run in does not matter.
  const regionService: any = container.resolve(Modules.REGION)
  const created = await regionService.createRegions({
    name: "E2E Quote Region",
    currency_code: "inr",
    countries: ["in"],
  })
  return (Array.isArray(created) ? created[0] : created).id
}

async function ensureSalesChannel(container: any): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
    filters: { name: CHANNEL_NAME },
  })
  if (data?.[0]) return data[0].id
  const { result } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: CHANNEL_NAME }] },
  })
  return result[0].id
}

async function ensurePublishableKey(
  container: any,
  salesChannelId: string
): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id", "token"],
    filters: { title: KEY_TITLE, type: "publishable" },
  })
  let key = data?.[0]
  if (!key) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: KEY_TITLE, type: "publishable", created_by: "" }],
      },
    })
    key = result[0]
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [salesChannelId] },
    })
  }
  return key.token
}

async function ensureWebsite(container: any, heroUrl: string) {
  const websiteService: any = container.resolve("websites")
  const theme = { ...THEME, hero: { ...THEME.hero, background_image_url: heroUrl } }
  const [existing] = await websiteService.listWebsites({ domain: DOMAIN })
  if (existing) {
    await websiteService.updateWebsites({ id: existing.id, theme, status: "Active" })
    return existing.id
  }
  const created = await websiteService.createWebsites({
    domain: DOMAIN,
    name: THEME.branding.store_name,
    status: "Active",
    primary_language: "en",
    // `off`: the in-house tracker would load a script from the CDN on every
    // page, the one outbound call this local stack is meant not to make.
    analytics_provider: "off",
    theme,
  })
  return created.id
}

async function ensureProduct(
  container: any,
  salesChannelId: string,
  images: string[]
): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: existing } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { handle: HANDLE },
  })
  if (existing?.[0]) return existing[0].id

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Ikat grid patterns of blue and yellow color",
          handle: HANDLE,
          status: "published" as any,
          description:
            "Handwoven ikat, gridded in blue and yellow. Woven to order in the pattern you choose.",
          thumbnail: images[0],
          images: images.map((url) => ({ url })),
          shipping_profile_id: profiles?.[0]?.id,
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Spin Type", values: ["HandSpun", "MilSpun"] }],
          variants: [
            {
              title: "HandSpun",
              sku: "E2E-IKAT-GRID-HANDSPUN",
              manage_inventory: false,
              options: { "Spin Type": "HandSpun" },
              prices: [{ amount: 4500, currency_code: "inr" }],
            },
            {
              title: "MilSpun",
              sku: "E2E-IKAT-GRID-MILSPUN",
              manage_inventory: false,
              options: { "Spin Type": "MilSpun" },
              prices: [{ amount: 3200, currency_code: "inr" }],
            },
          ],
        },
      ],
    },
  })
  const productId = result[0].id

  // Mirrors src/scripts/seed-ikat-spec-local.ts, which storefront-made-to-spec
  // .spec.ts asserts against value by value.
  await upsertProductSpecWorkflow(container).run({
    input: {
      product_id: productId,
      data: {
        weave_technique: "ikat",
        weave_label: "Ikat, grid, blue and yellow",
        accepting_custom_orders: true,
        custom_order_lead_time_days: 30,
        colors: [],
        fields: [
          { key: "warp", label: "Warp", value: "Cotton, 2/60s" },
          { key: "finished_size", label: "Finished size", value: '44" x 90"' },
        ],
        options: [
          {
            key: "color_pattern",
            label: "Color Pattern",
            help_text: "The gridded colourway this piece is woven in.",
            required: true,
            order: 0,
            values: [
              { label: "Pattern 1 - Blue/Mustard/Cream/Grey", order: 0 },
              { label: "Pattern 2 - Mustard/Dusty Blue/Grey", order: 1 },
              { label: "Pattern 3 - Blue/Yellow/Grey/Cream", order: 2 },
            ],
          },
          {
            key: "embroidery",
            label: "Embroidery",
            help_text: "Hand-worked after the weaving is finished.",
            required: false,
            order: 1,
            values: [
              { label: "Kashida — border only", note: "adds about 10 days", order: 0 },
              { label: "Kashida — border and pallu", note: "adds about 3 weeks", order: 1 },
              {
                label: "Sozni — fine, all over",
                note: "currently booked out",
                order: 2,
                available: false,
              },
            ],
          },
        ],
      } as any,
    },
  })
  return productId
}

export default async function seedStorefront({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const images = writeImages()
  const regionId = await ensureIndiaRegion(container)
  const salesChannelId = await ensureSalesChannel(container)
  const publishableKey = await ensurePublishableKey(container, salesChannelId)
  const websiteId = await ensureWebsite(container, images.hero)
  const productId = await ensureProduct(container, salesChannelId, images.product)

  const seed = {
    domain: DOMAIN,
    regionId,
    salesChannelId,
    publishableKey,
    websiteId,
    productId,
    productHandle: HANDLE,
    theme: THEME,
  }
  fs.writeFileSync(STOREFRONT_SEED_FILE, JSON.stringify(seed, null, 2))
  logger.info(
    `E2E storefront seed complete: website ${websiteId} (${DOMAIN}), ` +
      `product ${productId} (${HANDLE}). Saved to ${STOREFRONT_SEED_FILE}`
  )
}
