import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { IOrderModuleService, IProductModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { emailTemplatesData } from "../../src/scripts/seed-email-templates"
import { sendPartnerOrderPlacedWorkflow } from "../../src/workflows/email/workflows/send-partner-order-email"

jest.setTimeout(90 * 1000)

// A product image URL used to prove the thumbnail backfill: the order line item
// is created WITHOUT a thumbnail, and the resolve step must fill it from the
// live product's first image.
const PRODUCT_IMAGE_URL = "https://cdn.example.com/handloom-scarf.jpg"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let adminHeaders: { headers: Record<string, string> }

  /** Upsert the REAL partner-order templates (with the {{#each items}} +
   *  thumbnail markup) so the workflow renders production HTML, not a stub. */
  async function seedRealPartnerTemplates() {
    const svc: any = getContainer().resolve(EMAIL_TEMPLATES_MODULE)
    const keys = [
      "partner-order-placed",
      "partner-order-fulfilled",
      "partner-order-cancelled",
    ]
    for (const key of keys) {
      const data = emailTemplatesData.find((t: any) => t.template_key === key)!
      const [existing] = await svc.listEmailTemplates({ template_key: key })
      const payload = {
        name: data.name,
        template_key: data.template_key,
        subject: data.subject,
        html_content: data.html_content,
        from: (data as any).from,
        template_type: (data as any).template_type,
        locale: "en",
        is_active: true,
      }
      if (existing) {
        await svc.updateEmailTemplates({ id: existing.id, ...payload })
      } else {
        await svc.createEmailTemplates(payload)
      }
    }
  }

  async function createPartnerWithStore(unique: string) {
    const email = `po-email-${unique}@jyt.test`
    const password = "supersecret"
    await api.post("/auth/partner/emailpass/register", { email, password })
    let login = await api.post("/auth/partner/emailpass", { email, password })
    let headers = { Authorization: `Bearer ${login.data.token}` }

    const partnerRes = await api.post(
      "/partners",
      {
        name: `PO Email Partner ${unique}`,
        handle: `po-email-${unique}`,
        admin: { email, first_name: "Priya", last_name: "Partner" },
      },
      { headers }
    )
    const partnerId = partnerRes.data.partner.id as string

    // Re-login to pick up partner context, then create a store.
    login = await api.post("/auth/partner/emailpass", { email, password })
    headers = { Authorization: `Bearer ${login.data.token}` }

    const currenciesRes = await api.get("/admin/currencies", adminHeaders)
    const currencies = currenciesRes.data.currencies || []
    const currencyCode = String(
      (currencies.find((c: any) => c.code?.toLowerCase() === "usd") ||
        currencies[0])?.code || "usd"
    ).toLowerCase()

    await api.post(
      "/partners/stores",
      {
        store: {
          name: `PO Email Store ${unique}`,
          supported_currencies: [
            { currency_code: currencyCode, is_default: true },
          ],
        },
        region: {
          name: "PO Region",
          currency_code: currencyCode,
          countries: ["us"],
        },
        location: {
          name: "PO Warehouse",
          address: {
            address_1: "1 Loom Lane",
            city: "Jaipur",
            postal_code: "302001",
            country_code: "IN",
          },
        },
      },
      { headers }
    )

    // Read the store's default sales channel (retail ownership rule).
    const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.default_sales_channel_id"],
      filters: { id: partnerId },
    })
    const salesChannelId =
      partners?.[0]?.stores?.[0]?.default_sales_channel_id as string

    return { partnerId, email, salesChannelId, currencyCode }
  }

  /** Product with an image but NO root thumbnail → exercises the backfill. */
  async function createProductWithImage(unique: string) {
    const productService = getContainer().resolve(
      Modules.PRODUCT
    ) as IProductModuleService
    const [product] = await productService.createProducts([
      {
        title: `Handloom Scarf ${unique}`,
        status: "published",
        images: [{ url: PRODUCT_IMAGE_URL }],
        options: [{ title: "Size", values: ["OS"] }],
        variants: [{ title: "One Size", options: { Size: "OS" } }],
      },
    ] as any)
    return {
      productId: product.id as string,
      variantId: (product as any).variants[0].id as string,
      title: product.title as string,
    }
  }

  async function createOrder(opts: {
    unique: string
    salesChannelId?: string
    currency: string
    product: { productId: string; variantId: string; title: string }
  }) {
    const orderService = getContainer().resolve(
      Modules.ORDER
    ) as IOrderModuleService
    const order: any = await orderService.createOrders({
      currency_code: opts.currency,
      email: `po-buyer-${opts.unique}@jyt.test`,
      sales_channel_id: opts.salesChannelId,
      shipping_address: {
        first_name: "Riya",
        last_name: "Buyer",
        address_1: "22 Silk Road",
        city: "Mumbai",
        postal_code: "400001",
        country_code: "in",
      },
      items: [
        {
          title: opts.product.title,
          product_title: opts.product.title,
          product_id: opts.product.productId,
          variant_id: opts.product.variantId,
          quantity: 2,
          unit_price: 1500,
          // deliberately NO thumbnail → must be backfilled
        },
      ],
    } as any)
    return order
  }

  async function findNotification(email: string) {
    const notificationService: any = getContainer().resolve(Modules.NOTIFICATION)
    let found: any
    for (let i = 0; i < 20 && !found; i++) {
      const notifications = await notificationService.listNotifications({
        to: email,
      })
      found = (notifications || []).find(
        (n: any) => n.template === "partner-order-placed"
      )
      if (!found) await new Promise((r) => setTimeout(r, 200))
    }
    return found
  }

  beforeAll(async () => {
    await createAdminUser(getContainer())
    adminHeaders = await getAuthHeaders(api)
    await seedRealPartnerTemplates()
  })

  describe("partner-order-placed email — resolution + rendered template", () => {
    it("resolves a RETAIL partner (sales-channel rule) and renders items with thumbnails", async () => {
      const unique = `${Date.now()}r`
      const { partnerId, email, salesChannelId, currencyCode } =
        await createPartnerWithStore(unique)
      expect(salesChannelId).toBeTruthy()

      const product = await createProductWithImage(unique)
      const order = await createOrder({
        unique,
        salesChannelId,
        currency: currencyCode,
        product,
      })

      const { result } = await sendPartnerOrderPlacedWorkflow(
        getContainer()
      ).run({ input: { orderId: order.id } })

      // The core fix: the partner now resolves, so the email is actually sent.
      expect(result.skipped).toBe(false)
      expect(result.sent).toBeGreaterThanOrEqual(1)

      const notif = await findNotification(email)
      expect(notif).toBeTruthy()

      const html: string = notif.data?._template_html_content || ""
      // Thumbnail backfilled from the product's first image and rendered as <img>.
      expect(html).toContain(PRODUCT_IMAGE_URL)
      // Line item + store branding present.
      expect(html).toContain(product.title)
      expect(html).toContain(`PO Email Partner ${unique}`)
      // From address carries the partner handle.
      expect(notif.data?._partner_from_email).toBe(
        `partner+po-email-${unique}@partner.jaalyantra.com`
      )
      // Order total = 2 × 1500 formatted.
      expect(html).toMatch(/3,000|3000/)

      // Sanity: partner id round-trips.
      const partnerService: any = getContainer().resolve(PARTNER_MODULE)
      const [p] = await partnerService.listPartners({ id: partnerId })
      expect(p?.id).toBe(partnerId)
    })

    it("resolves a WORK-ORDER partner via the D3 partner↔order link", async () => {
      const unique = `${Date.now()}w`
      const { email, currencyCode } = await createPartnerWithStore(unique)
      // Re-fetch partner id from the notification path — recreate partner id:
      const partnerService: any = getContainer().resolve(PARTNER_MODULE)
      const [partner] = await partnerService.listPartners({
        handle: `po-email-${unique}`,
      })
      const partnerId = partner.id as string

      const product = await createProductWithImage(unique)
      // Order NOT in the partner's sales channel → retail rule won't match.
      const order = await createOrder({
        unique,
        salesChannelId: undefined,
        currency: currencyCode,
        product,
      })

      // Explicit D3 partner↔order link (work-order ownership).
      const remoteLink: any = getContainer().resolve(
        ContainerRegistrationKeys.LINK
      )
      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.ORDER]: { order_id: order.id },
          data: { partner_id: partnerId, order_id: order.id },
        },
      ])

      const { result } = await sendPartnerOrderPlacedWorkflow(
        getContainer()
      ).run({ input: { orderId: order.id } })

      expect(result.skipped).toBe(false)
      expect(result.sent).toBeGreaterThanOrEqual(1)

      const notif = await findNotification(email)
      expect(notif).toBeTruthy()
      const html: string = notif.data?._template_html_content || ""
      expect(html).toContain(PRODUCT_IMAGE_URL)
      expect(html).toContain(product.title)
    })

    it("skips (no send) when the order belongs to no partner", async () => {
      const unique = `${Date.now()}n`
      const product = await createProductWithImage(unique)
      const order = await createOrder({
        unique,
        salesChannelId: undefined,
        currency: "usd",
        product,
      })

      const { result } = await sendPartnerOrderPlacedWorkflow(
        getContainer()
      ).run({ input: { orderId: order.id } })

      expect(result.sent).toBe(0)
      expect(result.skipped).toBe(true)
    })
  })
})
