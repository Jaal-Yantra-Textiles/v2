import * as fs from "fs"
import * as path from "path"
import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

/**
 * #2645 — "if the deposit is mentioned then PayU should also seek that in the
 * first link", and the buyer's email must state the deposit due now, the
 * balance and when it is due.
 *
 * - create WITH a deposit: the schedule exists before the PayU link and the
 *   email, so the first link's amount is the deposit and the first email
 *   carries it.
 * - a deposit set LATER: a fresh deposit link is minted, the old full-total
 *   link is switched off at PayU, and the email is re-sent (notify_buyer
 *   default); notify_buyer:false sends nothing but still closes the old link.
 *
 * PayU is faked at `fetch` (nothing leaves the process); the email goes to
 * the local notification provider, rendered from the repo's template file.
 */
setupSharedTestSuite(() => {
  describe("design order deposit — the first link and email are for the deposit", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    let customerId: string
    let buyerEmail: string
    const realFetch = global.fetch
    const savedEnv: Record<string, string | undefined> = {}
    const ENV_KEYS = [
      "PAYU_CLIENT_ID",
      "PAYU_CLIENT_SECRET",
      "PAYU_MERCHANT_ID",
      "PAYU_ONEAPI_MODE",
      "PAYU_MERCHANT_KEY",
      "PAYU_MERCHANT_SALT",
    ]
    /** Every PayU call: link creates carry the amount PayU would charge. */
    const calls: { url: string; method: string; body?: any }[] = []
    let invoiceSeq = 0

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const { regions } = (await api.get("/admin/regions?limit=100", adminHeaders)).data
      const hasInr = (regions ?? []).some(
        (r: any) =>
          String(r.currency_code).toLowerCase() === "inr" &&
          (r.countries ?? []).some((c: any) => c.iso_2 === "in")
      )
      if (!hasInr) {
        await (container.resolve(Modules.REGION) as any).createRegions({
          name: "Deposit INR",
          currency_code: "inr",
          countries: ["in"],
          automatic_taxes: true,
        })
      }
      const tax: any = container.resolve(Modules.TAX)
      if (!(await tax.listTaxRegions({ country_code: "in" })).length) {
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "in",
              provider_id: "tp_system",
              default_tax_rate: { name: "GST", code: "GST", rate: 5 },
            } as any,
          ],
        })
      }

      // The template the operator will apply, straight from the repo.
      const html = fs.readFileSync(
        path.join(__dirname, "../../src/scripts/templates/design-order-created.html"),
        "utf8"
      )
      const templates: any = container.resolve(EMAIL_TEMPLATES_MODULE)
      const payload = {
        name: "Design order created",
        template_key: "design-order-created",
        subject: "Your order is ready",
        html_content: html,
        from: "orders@example.com",
        template_type: "email",
        locale: "en",
        is_active: true,
      }
      const [existing] = await templates.listEmailTemplates({ template_key: "design-order-created" })
      if (existing) await templates.updateEmailTemplates({ id: existing.id, ...payload })
      else await templates.createEmailTemplates(payload)

      buyerEmail = `deposit-buyer-${Date.now()}@example.com`
      const [customer] = await (container.resolve(Modules.CUSTOMER) as any).createCustomers([
        { email: buyerEmail, first_name: "Dep", last_name: "Osit" },
      ])
      customerId = customer.id

      for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
      Object.assign(process.env, {
        PAYU_CLIENT_ID: "cid",
        PAYU_CLIENT_SECRET: "sec",
        PAYU_MERCHANT_ID: "mid",
        PAYU_ONEAPI_MODE: "test",
      })
      // No UPI intent: that is a different PayU call, not under test here.
      delete process.env.PAYU_MERCHANT_KEY
      delete process.env.PAYU_MERCHANT_SALT

      global.fetch = (async (url: any, init: any = {}) => {
        const u = String(url)
        if (!/payu\.in/.test(u)) return realFetch(url, init)
        const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body
        calls.push({ url: u, method: init.method || "GET", body })
        const json = (b: any) => new Response(JSON.stringify(b), { status: 200 })
        if (u.includes("/oauth/token")) return json({ access_token: "tok" })
        if (init.method === "PUT") return json({ status: 0, result: {} })
        if (/\/payment-links$/.test(u) && init.method === "POST") {
          const inv = body?.invoiceNumber || `inv_fake_${++invoiceSeq}`
          return json({
            status: 0,
            result: { paymentLink: `https://u.payu.in/fake/${inv}`, invoiceNumber: inv },
          })
        }
        return json({ status: 0, result: {} })
      }) as any
    })

    afterAll(() => {
      global.fetch = realFetch
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
        else process.env[k] = savedEnv[k]
      }
    })

    const newDesign = async (price: number) =>
      (
        await api.post(
          "/admin/designs",
          {
            name: `Deposit Jacket ${Date.now()}-${Math.random()}`,
            description: "x",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
            estimated_cost: price,
            cost_currency: "inr",
          },
          adminHeaders
        )
      ).data.design.id as string

    const linkCreates = () =>
      calls.filter((c) => c.method === "POST" && /\/payment-links$/.test(c.url))

    const emailsFor = async (cartId: string) => {
      const notifications: any = getContainer().resolve(Modules.NOTIFICATION)
      const rows = await notifications.listNotifications({ to: buyerEmail })
      return (rows ?? []).filter(
        (n: any) => n.template === "design-order-created" && n.data?.cart_id === cartId
      )
    }

    const readCart = async (cartId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "total", "metadata", "items.id"],
        filters: { id: cartId },
      })
      return data[0]
    }

    it("create WITH a 50% deposit: the first PayU link and the first email are for the deposit", async () => {
      calls.length = 0
      const designId = await newDesign(10000)
      const res = await api
        .post(
          "/admin/designs/draft-order",
          {
            design_ids: [designId],
            currency_code: "inr",
            country_code: "in",
            customer_id: customerId,
            deposit_pct: 50,
            balance_trigger: "dispatch",
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(200)
      const cartId = res.data.cart.id
      const total = Number((await readCart(cartId)).total)
      const deposit = Math.round(total * 50) / 100

      // 🔴 The first (and only) PayU link asks for the DEPOSIT, not the total.
      const creates = linkCreates()
      expect(creates).toHaveLength(1)
      expect(creates[0].body.subAmount).toBe(Math.round(deposit))
      expect(creates[0].body.subAmount).toBeLessThan(Math.round(total))
      expect(res.data.payment_link).toBeTruthy()

      // The schedule was opened at creation.
      expect(res.data.deposit).toEqual(
        expect.objectContaining({ cart_id: cartId, deposit_pct: 50, balance_trigger: "dispatch" })
      )
      const schedules: any = getContainer().resolve("payment_schedule")
      expect(await schedules.findByCartId(cartId)).toBeTruthy()

      // The email went, and carries the deposit, the balance and when.
      expect(res.data.email.sent).toBe(true)
      const [email] = await emailsFor(cartId)
      expect(email).toBeTruthy()
      expect(email.data.total).toBeCloseTo(total, 2)
      expect(email.data.deposit).toEqual({
        amount: deposit,
        deposit_pct: 50,
        balance_amount: Math.round((total - deposit) * 100) / 100,
        balance_trigger: "dispatch",
        balance_when: "when your order is ready to ship — we'll email you a payment link",
      })
      const html = String(email.data._template_html_content ?? "")
      expect(html).toContain("Deposit due now &middot; 50%")
      expect(html).toContain("PAY DEPOSIT")
      expect(html).toContain("ready to ship")
    })

    it("create with a fixed deposit NOT below the real total: refused, and NOTHING is sent", async () => {
      calls.length = 0
      const designId = await newDesign(1000)
      const res = await api
        .post(
          "/admin/designs/draft-order",
          {
            design_ids: [designId],
            currency_code: "inr",
            country_code: "in",
            customer_id: customerId,
            deposit_amount: 999999,
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.reason).toBe("not_an_amount")
      expect(res.data.cart.id).toBeTruthy()
      expect(linkCreates()).toHaveLength(0)
      expect(await emailsFor(res.data.cart.id)).toHaveLength(0)
    })

    it("a deposit set LATER re-sends a deposit link + email and switches the old full-total link off", async () => {
      calls.length = 0
      const designId = await newDesign(8000)
      const created = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [designId], currency_code: "inr", country_code: "in", customer_id: customerId },
        adminHeaders
      )
      const cartId = created.data.cart.id
      const total = Number((await readCart(cartId)).total)
      // The original link: the full total, as before.
      expect(linkCreates()).toHaveLength(1)
      expect(linkCreates()[0].body.subAmount).toBe(Math.round(total))
      const oldInvoice = (await readCart(cartId)).metadata.payu_link.invoice_number
      expect((await emailsFor(cartId))[0].data.deposit).toBeNull()

      calls.length = 0
      const lineItemId = (await readCart(cartId)).items[0].id
      const set = await api
        .post(`/admin/designs/orders/${lineItemId}/deposit`, { deposit_pct: 30 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(set.status).toBe(200)
      const d = set.data.design_order_deposit
      const deposit = Math.round(total * 30) / 100
      expect(d.notified).toBe(true)
      expect(d.deposit_amount).toBeCloseTo(deposit, 2)
      expect(d.payment_link).toBeTruthy()
      expect(d.replaced_payment_link_invoice).toBe(oldInvoice)
      expect(d.email.sent).toBe(true)

      // The new link is for the deposit; the old one was switched off at PayU.
      expect(linkCreates()).toHaveLength(1)
      expect(linkCreates()[0].body.subAmount).toBe(Math.round(deposit))
      expect(
        calls.some((c) => c.method === "PUT" && c.url.includes(`/payment-links/${oldInvoice}`))
      ).toBe(true)

      const emails = await emailsFor(cartId)
      expect(emails).toHaveLength(2)
      const resent = emails.find((e: any) => e.data.deposit)
      expect(resent.data.deposit.amount).toBeCloseTo(deposit, 2)
      expect(resent.data.deposit.deposit_pct).toBe(30)
      expect(resent.data.deposit.balance_when).toBe(
        "when your order is ready — we'll email you a payment link"
      )
    })

    it("notify_buyer:false sends nothing and mints nothing, but still closes the old full-total link", async () => {
      calls.length = 0
      const designId = await newDesign(6000)
      const created = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [designId], currency_code: "inr", country_code: "in", customer_id: customerId },
        adminHeaders
      )
      const cartId = created.data.cart.id
      const oldInvoice = (await readCart(cartId)).metadata.payu_link.invoice_number

      calls.length = 0
      const lineItemId = (await readCart(cartId)).items[0].id
      const set = await api
        .post(
          `/admin/designs/orders/${lineItemId}/deposit`,
          { deposit_pct: 30, notify_buyer: false },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(set.status).toBe(200)
      const d = set.data.design_order_deposit
      expect(d.notified).toBe(false)
      expect(d.email).toBeNull()
      expect(d.payment_link).toBeNull()
      expect(d.closed_payment_link_invoice).toBe(oldInvoice)
      expect(linkCreates()).toHaveLength(0)
      expect(
        calls.some((c) => c.method === "PUT" && c.url.includes(`/payment-links/${oldInvoice}`))
      ).toBe(true)
      expect((await readCart(cartId)).metadata.payu_link.closed_reason).toBe("deposit_set")
      // Only the original email exists.
      expect(await emailsFor(cartId)).toHaveLength(1)

      // A non-boolean notify_buyer is a 400, not a silent default.
      const bad = await api
        .post(
          `/admin/designs/orders/${lineItemId}/deposit`,
          { deposit_pct: 40, replace: true, notify_buyer: "no" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(bad.status).toBe(400)
    })
  })
})
