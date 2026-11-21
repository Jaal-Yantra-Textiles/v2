import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import expireDesignOrderPayuLinks from "../../src/jobs/expire-design-order-payu-links"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * #2564 — design-order PayU links expire. PayU sends no expiry event, so the
 * sweep job and the QR route are the only things that act on `expires_at`.
 * PayU itself is faked at `fetch`; the SQL, the cart metadata and the route
 * are real.
 */
setupSharedTestSuite(() => {
  describe("design-order PayU link expiry", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    const realFetch = global.fetch
    const calls: { url: string; method: string; body?: any }[] = []
    let paidAtPayu = false

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
          name: "Expiry INR",
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

      Object.assign(process.env, {
        PAYU_CLIENT_ID: "cid",
        PAYU_CLIENT_SECRET: "sec",
        PAYU_MERCHANT_ID: "mid",
        PAYU_ONEAPI_MODE: "test",
      })
      global.fetch = (async (url: any, init: any = {}) => {
        const u = String(url)
        if (!/payu\.in/.test(u)) return realFetch(url, init)
        calls.push({ url: u, method: init.method || "GET", body: init.body })
        const json = (b: any) => new Response(JSON.stringify(b), { status: 200 })
        if (u.includes("/oauth/token")) return json({ access_token: "tok" })
        if (u.includes("/txns"))
          return json({ result: { data: paidAtPayu ? [{ status: "success", settledAmount: 99999, transactionId: "t1" }] : [] } })
        if (init.method === "PUT") return json({ status: 0, result: {} })
        return json({ status: 0, result: {} })
      }) as any
    })

    afterAll(() => {
      global.fetch = realFetch
    })

    // One design per cart — a design can sit in only one open checkout.
    const newCart = async () => {
      const designId = (
        await api.post(
          "/admin/designs",
          {
            name: `Expiry Shirt ${Date.now()}-${Math.random()}`,
            description: "x",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
            estimated_cost: 5000,
            cost_currency: "inr",
          },
          adminHeaders
        )
      ).data.design.id
      const res = await api
        .post(
          "/admin/designs/draft-order",
          { design_ids: [designId], currency_code: "inr", country_code: "in" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      if (res.status !== 200) throw new Error(`draft-order ${res.status}: ${JSON.stringify(res.data)}`)
      return res.data.cart.id as string
    }

    const setLink = async (cartId: string, link: any, extra: any = {}) => {
      const carts: any = getContainer().resolve(Modules.CART)
      const [c] = await carts.listCarts({ id: cartId }, { select: ["id", "metadata"] })
      await carts.updateCarts(cartId, { metadata: { ...(c.metadata ?? {}), ...extra, payu_link: link } })
    }
    const readLink = async (cartId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "cart", fields: ["metadata"], filters: { id: cartId } })
      return data[0].metadata?.payu_link
    }
    const link = (inv: string, expiresAt: Date) => ({
      invoice_number: inv,
      url: "https://u.payu.in/PAYUMN/abc",
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
      closed_at: null,
      closed_reason: null,
      expiry_notified_at: null,
    })

    it("closes an expired link at PayU and leaves a live one alone; the QR follows", async () => {
      const expired = await newCart()
      const live = await newCart()
      await setLink(expired, link("inv_exp", new Date(Date.now() - 60_000)))
      await setLink(live, link("inv_live", new Date(Date.now() + 3600_000)))

      // QR renders for the live link, 410 for the expired one.
      const qr = await api.get(`/r/cart/${live}/pay-qr`, { responseType: "arraybuffer" })
      expect(qr.status).toBe(200)
      expect(qr.headers["content-type"]).toContain("image/png")
      const gone = await api.get(`/r/cart/${expired}/pay-qr`).catch((e: any) => e.response)
      expect(gone.status).toBe(410)

      calls.length = 0
      await expireDesignOrderPayuLinks(getContainer() as any)

      const puts = calls.filter((c) => c.method === "PUT")
      expect(puts.map((c) => c.url)).toEqual([expect.stringContaining("/payment-links/inv_exp")])
      expect(JSON.parse(puts[0].body)).toEqual({ active: false })

      const after = await readLink(expired)
      expect(after.closed_reason).toBe("expired")
      expect(after.closed_at).toBeTruthy()
      expect((await readLink(live)).closed_at).toBeNull()

      // A second run does not close it again.
      calls.length = 0
      await expireDesignOrderPayuLinks(getContainer() as any)
      expect(calls.filter((c) => c.method === "PUT" && c.url.includes("inv_exp"))).toHaveLength(0)
    })

    it("🔴 never closes or 'expires' a link PayU says was PAID", async () => {
      const cart = await newCart()
      await setLink(cart, link("inv_paid", new Date(Date.now() - 60_000)))
      paidAtPayu = true
      calls.length = 0
      try {
        await expireDesignOrderPayuLinks(getContainer() as any)
      } finally {
        paidAtPayu = false
      }
      expect(calls.filter((c) => c.method === "PUT" && c.url.includes("inv_paid"))).toHaveLength(0)
      expect((await readLink(cart)).closed_reason).toBe("paid")
    })

    it("closes a still-live link on a cancelled design order", async () => {
      const cart = await newCart()
      await setLink(cart, link("inv_cxl", new Date(Date.now() + 3600_000)), {
        cancelled_at: new Date().toISOString(),
      })
      calls.length = 0
      await expireDesignOrderPayuLinks(getContainer() as any)
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("inv_cxl"))).toBe(true)
      expect((await readLink(cart)).closed_reason).toBe("cancelled")
    })
  })
})
