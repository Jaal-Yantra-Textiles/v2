/**
 * #2608 — attach a partner's rate to a brief choice after the brief exists
 * (Sharlho quoted for stitching once the RMIT brief was already sent).
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/quote-brief-choice-rate
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PARTNER_MODULE } from "../../src/modules/partner"
import { PARTNER_CAPABILITY_MODULE } from "../../src/modules/partner_capability"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240_000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /admin/quote-briefs/:id/choices/:choiceId", () => {
    let headers: Record<string, any>
    let briefId: string
    let sharlhoChoiceId: string
    let otherBriefChoiceId: string
    const ids: Record<string, string> = {}

    const rate = (partner_id: string, technique: string, low: number, high: number | null) =>
      getContainer()
        .resolve<any>(PARTNER_CAPABILITY_MODULE)
        .createPartnerCapabilityRates({
          partner_id,
          technique,
          unit: "piece",
          price_low: low,
          price_high: high,
          currency_code: "inr",
          tax_basis: "unknown",
          source: "partner_quoted",
          status: "confirmed",
          observed_at: new Date(),
        })

    const createBrief = async (title: string) => {
      const res = await api.post(
        "/admin/quote-briefs",
        {
          partner_id: ids.lead,
          title,
          destination_country_code: "in",
          buyer_email: "buyer@example.com",
          options: [
            {
              title: "Canvas tote",
              steps: [
                {
                  label: "Bag stitching",
                  technique: "stitching",
                  choices: [{ partner_id: ids.sharlho }, { partner_id: ids.shramdaan }],
                },
              ],
            },
          ],
        },
        headers
      )
      expect(res.status).toBe(201)
      return res.data.brief
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
      const u = Date.now().toString(36)

      const partners: any = container.resolve(PARTNER_MODULE)
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)
      for (const name of ["lead", "sharlho", "shramdaan"]) {
        const p = await partners.createPartners({ name: `${name} ${u}`, handle: `${name}-${u}`, status: "active" })
        ids[name] = p.id
      }
      // A brief is served from its lead's store.
      const store = await container.resolve<any>(Modules.STORE).createStores({ name: `lead store ${u}` })
      await link.create({ [PARTNER_MODULE]: { partner_id: ids.lead }, [Modules.STORE]: { store_id: store.id } })

      const brief = await createBrief(`Bags ${u}`)
      briefId = brief.id
      sharlhoChoiceId = brief.options[0].steps[0].choices.find((c: any) => c.partner.id === ids.sharlho).id
      const other = await createBrief(`Other ${u}`)
      otherBriefChoiceId = other.options[0].steps[0].choices[0].id
    })

    it("attaches the partner's own rate and the estimate picks it up", async () => {
      const r = await rate(ids.sharlho, "stitching", 1000, 1500)
      const res = await api.post(`/admin/quote-briefs/${briefId}/choices/${sharlhoChoiceId}`, { rate_id: r.id, note: "Dharamshala unit" }, headers)
      expect(res.status).toBe(200)

      const step = res.data.brief.options[0].steps[0]
      const choice = step.choices.find((c: any) => c.id === sharlhoChoiceId)
      expect(choice.rate_id).toBe(r.id)
      expect(choice.note).toBe("Dharamshala unit")
      expect(choice.estimate).toMatchObject({ low: 1000, high: 1500, currency_code: "inr" })
      expect(step.state).toBe("estimated")

      // Read the row back, not just the response.
      const [row] = await getContainer().resolve<any>(PARTNER_QUOTE_MODULE).listPartnerQuoteBriefChoices({ id: sharlhoChoiceId })
      expect(row.rate_id).toBe(r.id)

      // Clearing goes back to "we'll confirm".
      const cleared = await api.post(`/admin/quote-briefs/${briefId}/choices/${sharlhoChoiceId}`, { rate_id: null }, headers)
      expect(cleared.data.brief.options[0].steps[0].state).toBe("ask")
    })

    it("refuses another workshop's rate under this partner's name", async () => {
      const shramdaanRate = await rate(ids.shramdaan, "stitching", 800, null)
      const res = await api
        .post(`/admin/quote-briefs/${briefId}/choices/${sharlhoChoiceId}`, { rate_id: shramdaanRate.id }, headers)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.message).toContain("belongs to another partner")

      const [row] = await getContainer().resolve<any>(PARTNER_QUOTE_MODULE).listPartnerQuoteBriefChoices({ id: sharlhoChoiceId })
      expect(row.rate_id).toBeNull()
    })

    it("treats a choice from another brief as not found", async () => {
      const r = await rate(ids.sharlho, "stitching", 1000, 1500)
      const res = await api
        .post(`/admin/quote-briefs/${briefId}/choices/${otherBriefChoiceId}`, { rate_id: r.id }, headers)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })

    it("refuses once the brief is closed", async () => {
      await getContainer().resolve<any>(PARTNER_QUOTE_MODULE).updatePartnerQuoteBriefs({ id: briefId, status: "closed" })
      const r = await rate(ids.sharlho, "stitching", 1000, 1500)
      const res = await api
        .post(`/admin/quote-briefs/${briefId}/choices/${sharlhoChoiceId}`, { rate_id: r.id }, headers)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("refuses an empty body", async () => {
      const res = await api.post(`/admin/quote-briefs/${briefId}/choices/${sharlhoChoiceId}`, {}, headers).catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })
  })
})
