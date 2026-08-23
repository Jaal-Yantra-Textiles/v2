import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"
import { QUOTE_TEMPLATE_DEFINITION, QUOTE_TEMPLATE_KEY } from "../../src/scripts/seed-quote-email-template"

jest.setTimeout(240 * 1000)

/**
 * Delivering the buyer's link (#1420).
 *
 * ## The property this file exists to protect
 *
 * 🔴 The raw token is returned by the mint exactly once and only its sha256 is
 * stored. So the send sits downstream of a quote that has ALREADY created a
 * live price list, and anything that lets a delivery failure propagate destroys
 * the only copy of a link to prices that are now live for a real buyer.
 *
 * That makes the most important test here the ugly one: **the mint still
 * returns 201 and a token when the email cannot be sent.** It is the assertion
 * a happy-path suite never makes, and the one whose absence is unrecoverable.
 *
 * ## Why an integration test and not a unit test
 *
 * The pure pieces are covered in `quote-link.unit.spec.ts` and
 * `quote-email.unit.spec.ts`. What those cannot see is the wiring: that the
 * route awaits the send, that the verdict reaches the response body, that
 * `email_sent_at` is written to the row, and that the timeline records it.
 * Every one of those is a call site, and this epic has already shipped two
 * defects that lived only in wiring.
 */

setupSharedTestSuite(() => {
  describe("POST /partners/quotes — delivering the buyer link (#1420)", () => {
    let seed: QuoteFixture

    const container = () => getSharedTestEnv().getContainer()

    /** Give the partner a provisioned subdomain, as prod partners have. */
    const setPartnerDomain = async (domain: string | null) => {
      const service: any = container().resolve(PARTNER_MODULE)
      await service.updatePartners({
        id: seed.partnerId,
        storefront_domain: domain,
      })
    }

    const seedTemplate = async () => {
      const service: any = container().resolve(EMAIL_TEMPLATES_MODULE)
      const existing = await service
        .listEmailTemplates({ template_key: QUOTE_TEMPLATE_KEY })
        .catch(() => [])
      if (existing?.length) return
      await service.createEmailTemplates({
        ...QUOTE_TEMPLATE_DEFINITION,
        is_active: true,
      })
    }

    const readQuote = async (id: string) => {
      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      return await service.retrievePartnerQuote(id)
    }

    const readEvents = async (id: string) => {
      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      return (await service.listPartnerQuoteEvents({ quote_id: id })) ?? []
    }

    beforeAll(async () => {
      await createAdminUser(container())
      seed = await setupQuoteFixture(getSharedTestEnv().api, () => container())
    })

    it("emails the buyer their link, and records that it went", async () => {
      const { api } = getSharedTestEnv()
      await seedTemplate()
      await setPartnerDomain("quote-email-test.jaalyantra.com")

      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, { buyer_email: `sent-${seed.unique}@jaalyantra.test` }),
        { headers: seed.headers }
      )

      expect(res.status).toBe(201)
      expect(res.data.email?.sent).toBe(true)
      expect(res.data.email?.to).toBe(`sent-${seed.unique}@jaalyantra.test`)
      expect(res.data.email?.reason).toBeNull()

      // Composed server-side. Both UIs used to build this themselves, and the
      // admin one read fields the quote does not carry.
      const country = String(
        res.data.quote.destination_country_code
      ).toLowerCase()
      expect(res.data.buyer_url).toBe(
        `https://quote-email-test.jaalyantra.com/${country}/quotes/${res.data.token}`
      )

      // 🔑 Written to the ROW, not just reported in the response. This is the
      // column that answers "which quotes never reached their buyer", and a
      // verdict that lives only in a response body cannot answer it tomorrow.
      const row = await readQuote(res.data.quote.id)
      expect(row.email_sent_at).toBeTruthy()

      const events = await readEvents(res.data.quote.id)
      expect(events.map((e: any) => e.type)).toContain("emailed")
    })

    it("falls back to the house storefront when the partner has no domain", async () => {
      // #1420 — an admin quoting for a domainless partner used to get nothing
      // to send. The house storefront (ROOT_DOMAIN) is the LAST resort, never
      // preferred over the partner's own shop.
      const { api } = getSharedTestEnv()
      await seedTemplate()
      await setPartnerDomain(null)

      const prevRoot = process.env.ROOT_DOMAIN
      process.env.ROOT_DOMAIN = "cicilabel.test"
      try {
        const res = await api.post(
          "/partners/quotes",
          mintBody(seed, { buyer_email: `house-${seed.unique}@jaalyantra.test` }),
          { headers: seed.headers }
        )

        expect(res.status).toBe(201)
        const country = String(res.data.quote.destination_country_code).toLowerCase()
        expect(res.data.buyer_url).toBe(
          `https://cicilabel.test/${country}/quotes/${res.data.token}`
        )
        expect(res.data.email?.sent).toBe(true)
      } finally {
        if (prevRoot === undefined) delete process.env.ROOT_DOMAIN
        else process.env.ROOT_DOMAIN = prevRoot
      }
    })

    it("🔴 still returns 201 and the token when there is nowhere to point the buyer", async () => {
      // THE test. The price list is already live and the token in this response
      // is its only key — a throw here, or a 500, would strand a real buyer's
      // prices behind a link nobody can ever reconstruct.
      const { api } = getSharedTestEnv()
      await seedTemplate()
      await setPartnerDomain(null)

      const prevRoot = process.env.ROOT_DOMAIN
      const prevFront = process.env.FRONTEND_URL
      delete process.env.ROOT_DOMAIN
      delete process.env.FRONTEND_URL
      try {
        const res = await api.post(
          "/partners/quotes",
          mintBody(seed, { buyer_email: `unsent-${seed.unique}@jaalyantra.test` }),
          { headers: seed.headers }
        )

        expect(res.status).toBe(201)
        expect(typeof res.data.token).toBe("string")
        expect(res.data.token.length).toBeGreaterThan(20)
        expect(res.data.quote?.price_list_id).toBeTruthy()

        // Reported in words a human can act on — not swallowed.
        expect(res.data.buyer_url).toBeNull()
        expect(res.data.email?.sent).toBe(false)
        expect(res.data.email?.reason).toContain("storefront domain")

        const row = await readQuote(res.data.quote.id)
        expect(row.email_sent_at).toBeFalsy()
        // `email_sent_to` is written at mint from `buyer_email` regardless — it
        // is the intended recipient, which is exactly why it cannot be read as
        // proof of delivery.
        expect(row.email_sent_to).toBe(`unsent-${seed.unique}@jaalyantra.test`)

        const events = await readEvents(res.data.quote.id)
        expect(events.map((e: any) => e.type)).toContain("email_skipped")
        expect(events.map((e: any) => e.type)).not.toContain("emailed")
      } finally {
        if (prevRoot !== undefined) process.env.ROOT_DOMAIN = prevRoot
        if (prevFront !== undefined) process.env.FRONTEND_URL = prevFront
      }
    })

    it("does not report a send when the template is missing", async () => {
      // `fetchEmailTemplateStep` throws rather than falling back to a provider
      // default — correct, because a default template carries no link at all
      // and would look like a success.
      const { api } = getSharedTestEnv()
      await setPartnerDomain("quote-email-test.jaalyantra.com")

      const service: any = container().resolve(EMAIL_TEMPLATES_MODULE)
      const rows = await service
        .listEmailTemplates({ template_key: QUOTE_TEMPLATE_KEY })
        .catch(() => [])
      for (const row of rows ?? []) {
        await service.deleteEmailTemplates([row.id]).catch(() => {})
      }

      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, { buyer_email: `notpl-${seed.unique}@jaalyantra.test` }),
        { headers: seed.headers }
      )

      expect(res.status).toBe(201)
      expect(res.data.token).toBeTruthy()
      expect(res.data.email?.sent).toBe(false)
      expect(res.data.email?.reason).toBeTruthy()
      // The link is still handed back so a human can send it themselves.
      expect(res.data.buyer_url).toContain("/quotes/")

      const row = await readQuote(res.data.quote.id)
      expect(row.email_sent_at).toBeFalsy()
    })
  })
})
