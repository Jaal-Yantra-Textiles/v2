import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createApiKeysWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_MODULE } from "../../src/modules/partner"
import { PERSON_MODULE } from "../../src/modules/person"
import { PERSON_TYPE_MODULE } from "../../src/modules/persontype"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { CONSUMPTION_LOG_MODULE } from "../../src/modules/consumption_log"
import { PARTNER_CAPABILITY_MODULE } from "../../src/modules/partner_capability"

jest.setTimeout(90000)

/**
 * #2444 — GET /store/custom/partners/:handle, the partner's public page.
 * Opt-in (`is_public`), people as role counts only, energy from measured logs
 * only (never the #697 backfill).
 */
setupSharedTestSuite(() => {
  describe("Store: public partner page (#2444)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let storeHeaders: any

    beforeEach(async () => {
      const container = getContainer()
      const { result: keys } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ type: "publishable", title: "Partner page key", created_by: "admin" }] },
      })
      storeHeaders = { headers: { "x-publishable-api-key": keys[0].token } }
    })

    const seedPartner = async (handle: string, is_public: boolean) => {
      const container = getContainer()
      const partners = container.resolve(PARTNER_MODULE) as any
      const partner = await partners.createPartners({
        name: "HR Handloom",
        handle,
        status: "active",
        is_verified: true,
        is_public,
        country_code: "IN",
        metadata: {
          business_description: "Organic Kala cotton, woven by hand in Kutch.",
          story: "A quote about the platform, not about them.",
          contact_phone: "7737594880",
        },
      })

      const personTypes = container.resolve(PERSON_TYPE_MODULE) as any
      const [weaver, dyer] = await personTypes.createPersonTypes([
        { name: `Weaver ${handle}` },
        { name: `Dyer ${handle}` },
      ])
      const people = container.resolve(PERSON_MODULE) as any
      const [haresh, second] = await people.createPeople([
        { first_name: "Haresh", last_name: "Hemraj", email: `haresh-${handle}@example.com` },
        { first_name: "Second", last_name: "Weaver", email: `second-${handle}@example.com` },
      ])
      const link = container.resolve(ContainerRegistrationKeys.LINK) as any
      await link.create([
        { [PARTNER_MODULE]: { partner_id: partner.id }, [PERSON_MODULE]: { person_id: haresh.id } },
        { [PARTNER_MODULE]: { partner_id: partner.id }, [PERSON_MODULE]: { person_id: second.id } },
        { [PERSON_MODULE]: { person_id: haresh.id }, [PERSON_TYPE_MODULE]: { person_type_id: weaver.id } },
        { [PERSON_MODULE]: { person_id: haresh.id }, [PERSON_TYPE_MODULE]: { person_type_id: dyer.id } },
        { [PERSON_MODULE]: { person_id: second.id }, [PERSON_TYPE_MODULE]: { person_type_id: weaver.id } },
      ])

      const runs = container.resolve(PRODUCTION_RUNS_MODULE) as any
      const [done, open] = await runs.createProductionRuns([
        {
          design_id: "design_story_a",
          partner_id: partner.id,
          status: "completed",
          run_type: "production",
          quantity: 9,
          produced_quantity: 9,
          completed_at: new Date(),
          snapshot: {},
          captured_at: new Date(),
        },
        { design_id: "design_story_b", partner_id: partner.id, status: "in_progress", quantity: 5, snapshot: {}, captured_at: new Date() },
      ])

      const logs = container.resolve(CONSUMPTION_LOG_MODULE) as any
      await logs.createConsumptionLogs([
        // measured by someone
        { design_id: "design_story_a", production_run_id: done.id, consumption_type: "energy_electricity", quantity: 12, unit_of_measure: "kWh", quantity_basis: "total", consumed_at: new Date() },
        // synthesised by the #697 backfill: must not show
        { design_id: "design_story_a", production_run_id: done.id, consumption_type: "energy_electricity", quantity: 30, unit_of_measure: "kWh", consumed_at: new Date(), metadata: { source: "ops_maintenance_backfill_finished_run_consumption" } },
        // a run not finished yet: not part of what they made
        { design_id: "design_story_b", production_run_id: open.id, consumption_type: "energy_water", quantity: 100, unit_of_measure: "Liter", consumed_at: new Date() },
      ])

      const caps = container.resolve(PARTNER_CAPABILITY_MODULE) as any
      await caps.createPartnerCapabilitySamples([
        { partner_id: partner.id, title: "Woven Kala Cotton Fabric", technique: "Handloom", material: "Kala Cotton", product_type: "Fabric", actions: ["weave"], source: "admin", captured_at: new Date() },
      ])
      return partner
    }

    it("shows a public partner: roles counted, measured energy only, no names or contact", async () => {
      await seedPartner("hr-handloom-public", true)

      const res = await api.get(`/store/custom/partners/hr-handloom-public`, storeHeaders)
      expect(res.status).toBe(200)
      const p = res.data.partner

      expect(p.name).toBe("HR Handloom")
      expect(p.about).toBe("Organic Kala cotton, woven by hand in Kutch.")
      expect(p.roles).toEqual([
        { role: "Weaver hr-handloom-public", count: 2 },
        { role: "Dyer hr-handloom-public", count: 1 },
      ])
      expect(p.making).toMatchObject({ pieces_made: 9, pieces_last_90_days: 9, samples_made: 0 })
      expect(p.energy).toEqual({ electricity_kwh: 12, water_liters: 0, gas_cubic_meters: 0 })
      expect(p.capabilities).toEqual([
        expect.objectContaining({ title: "Woven Kala Cotton Fabric", technique: "Handloom", images: [] }),
      ])

      const raw = JSON.stringify(res.data)
      expect(raw).not.toContain("Haresh")
      expect(raw).not.toContain("example.com")
      expect(raw).not.toContain("7737594880")
      expect(raw).not.toContain("A quote about the platform")
      expect(p.metadata).toBeUndefined()
    })

    it("404s a partner who has not switched the page on", async () => {
      await seedPartner("hr-handloom-private", false)
      const res = await api
        .get(`/store/custom/partners/hr-handloom-private`, storeHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })

    it("404s an unknown handle", async () => {
      const res = await api
        .get(`/store/custom/partners/nobody-here`, storeHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
