import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run — energy rates + cost summary", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      // Seed email templates
      const emailTemplates = [
        {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "Partner account at {{partner_name}}",
          html_content: `<div>Partner {{partner_name}} created.</div>`,
          from: "partners@jaalyantra.com",
          variables: { partner_name: "name", temp_password: "pwd" },
          template_type: "email",
        },
        {
          name: "Design Production Started",
          template_key: "design-production-started",
          subject: "Production started for {{design_name}}",
          html_content: `<div>Production for {{design_name}} has started.</div>`,
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
        {
          name: "Design Production Completed",
          template_key: "design-production-completed",
          subject: "Production completed for {{design_name}}",
          html_content: `<div>Production for {{design_name}} is complete.</div>`,
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
      ]
      for (const tpl of emailTemplates) {
        try { await api.post("/admin/email-templates", tpl, adminHeaders) } catch {}
      }

      // Create partner
      const email = `energy-partner-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login1 = await api.post("/auth/partner/emailpass", { email, password })
      const partnerRes = await api.post(
        "/partners",
        {
          name: `Energy Partner ${unique}`,
          handle: `energy-partner-${unique}`,
          admin: { email, first_name: "Energy", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )
      const partnerId = partnerRes.data.partner.id
      const login2 = await api.post("/auth/partner/emailpass", { email, password })
      const partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      // Create design
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Energy Cost Design ${unique}`,
          description: "For energy cost testing",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      const designId = designRes.data.design.id

      // Create task template
      const tplRes = await api.post(
        "/admin/task-templates",
        {
          name: `energy-task-${unique}`,
          description: "Energy cost test task",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          category: "Production",
        },
        adminHeaders
      )
      const templateName = tplRes.data.task_template.name

      // Create + approve + dispatch production run
      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 10 },
        adminHeaders
      )
      const runId = runRes.data.production_run.id

      // Approve with template_names → auto-dispatches (no ordering = auto-dispatch)
      const approveRes = await api.post(
        `/admin/production-runs/${runId}/approve`,
        {
          assignments: [
            { partner_id: partnerId, role: "weaving", template_names: [templateName] },
          ],
        },
        adminHeaders
      )
      const childRunId = approveRes.data.result.children[0].id

      // Wait for sent_to_partner (auto-dispatched by approve)
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const r = await api.get(`/admin/production-runs/${childRunId}`, adminHeaders)
        if (r.data.production_run?.status === "sent_to_partner") break
        await new Promise((r) => setTimeout(r, 200))
      }

      // Partner accepts + starts
      await api.post(`/partners/production-runs/${childRunId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${childRunId}/start`, {}, { headers: partnerHeaders })

      return { adminHeaders, partnerId, partnerHeaders, designId, runId, childRunId, templateName, unique }
    }

    it("should create energy rates, log energy consumptions, and compute cost summary", async () => {
      const { adminHeaders, partnerHeaders, designId, childRunId } = await setupTestData()

      // 1) Create energy rates
      const electricityRate = await api.post(
        "/admin/energy-rates",
        {
          name: "India Electricity Rate",
          energyType: "energy_electricity",
          unitOfMeasure: "kWh",
          ratePerUnit: 8.5,
          currency: "inr",
          effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
          isActive: true,
          notes: "Standard industrial rate",
        },
        adminHeaders
      )
      expect(electricityRate.status).toBe(201)
      expect(electricityRate.data.energy_rate.rate_per_unit).toBe(8.5)

      const waterRate = await api.post(
        "/admin/energy-rates",
        {
          name: "Water Rate",
          energyType: "energy_water",
          unitOfMeasure: "Liter",
          ratePerUnit: 0.05,
          currency: "inr",
          effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
          isActive: true,
        },
        adminHeaders
      )
      expect(waterRate.status).toBe(201)

      const laborRate = await api.post(
        "/admin/energy-rates",
        {
          name: "Standard Labor Rate",
          energyType: "labor",
          unitOfMeasure: "Hour",
          ratePerUnit: 250,
          currency: "inr",
          effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
          isActive: true,
        },
        adminHeaders
      )
      expect(laborRate.status).toBe(201)

      // 2) List and verify rates
      const listRes = await api.get("/admin/energy-rates?is_active=true", adminHeaders)
      expect(listRes.status).toBe(200)
      expect(listRes.data.energy_rates.length).toBeGreaterThanOrEqual(3)

      // 3) Retrieve a single rate
      const rateId = electricityRate.data.energy_rate.id
      const getRes = await api.get(`/admin/energy-rates/${rateId}`, adminHeaders)
      expect(getRes.status).toBe(200)
      expect(getRes.data.energy_rate.energy_type).toBe("energy_electricity")

      // 4) Update a rate
      const updateRes = await api.post(
        `/admin/energy-rates/${rateId}`,
        { ratePerUnit: 9.0, notes: "Updated rate" },
        adminHeaders
      )
      expect(updateRes.status).toBe(200)
      expect(updateRes.data.energy_rate.rate_per_unit).toBe(9)

      // 5) Log energy + labor consumptions on the production run via partner
      // Partner finishes the run first
      await api.post(`/partners/production-runs/${childRunId}/finish`, {}, { headers: partnerHeaders })

      // Complete with energy + labor consumptions
      const completeRes = await api.post(
        `/partners/production-runs/${childRunId}/complete`,
        {
          produced_quantity: 9,
          rejected_quantity: 1,
          partner_cost_estimate: 5000,
          cost_type: "total",
          consumptions: [
            {
              quantity: 120,
              consumption_type: "energy_electricity",
              unit_of_measure: "kWh",
              notes: "Loom power consumption",
            },
            {
              quantity: 500,
              unit_cost: 0.04,
              consumption_type: "energy_water",
              unit_of_measure: "Liter",
              notes: "Dyeing water usage",
            },
            {
              quantity: 16,
              consumption_type: "labor",
              unit_of_measure: "Hour",
              notes: "Two artisans, 8 hours each",
            },
          ],
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.consumptions_logged).toBe(3)

      // 6) Fetch cost summary
      const costRes = await api.get(
        `/admin/production-runs/${childRunId}/cost-summary`,
        adminHeaders
      )
      expect(costRes.status).toBe(200)

      const summary = costRes.data.cost_summary
      expect(summary.production_run_id).toBe(childRunId)
      expect(summary.produced_quantity).toBe(9)
      expect(summary.rejected_quantity).toBe(1)
      expect(summary.total_consumption_logs).toBe(3)

      // Energy: electricity used rate fallback (no unit_cost on log → 120 kWh × 9.0 = 1080)
      expect(summary.energy.breakdown.length).toBeGreaterThanOrEqual(2)
      const elecBreakdown = summary.energy.breakdown.find(
        (b: any) => b.energy_type === "energy_electricity"
      )
      expect(elecBreakdown).toBeTruthy()
      expect(elecBreakdown.total_quantity).toBe(120)
      expect(elecBreakdown.rate_per_unit).toBe(9) // updated rate
      expect(elecBreakdown.total_cost).toBe(1080) // 120 × 9.0

      // Water: used log unit_cost (500 × 0.04 = 20), NOT the rate (0.05)
      const waterBreakdown = summary.energy.breakdown.find(
        (b: any) => b.energy_type === "energy_water"
      )
      expect(waterBreakdown).toBeTruthy()
      expect(waterBreakdown.total_cost).toBe(20) // 500 × 0.04

      // Energy total = 1080 + 20 = 1100
      expect(summary.energy.total).toBe(1100)

      // Labor: rate fallback (16 hours × 250 = 4000)
      expect(summary.labor.total_hours).toBe(16)
      expect(summary.labor.rate_per_hour).toBe(250)
      expect(summary.labor.total).toBe(4000)

      // Partner cost
      expect(summary.partner.estimate).toBe(5000)
      expect(summary.partner.total).toBe(5000)

      // Grand total = energy(1100) + labor(4000) + partner(5000) = 10100
      expect(summary.grand_total).toBe(10100)
      // Cost per unit = 10100 / 9 produced
      expect(summary.cost_per_unit).toBeCloseTo(10100 / 9, 1)

      // 7) Delete a rate
      const deleteRes = await api.delete(`/admin/energy-rates/${rateId}`, adminHeaders)
      expect(deleteRes.status).toBe(200)
      expect(deleteRes.data.deleted).toBe(true)

      // Verify it's gone
      try {
        await api.get(`/admin/energy-rates/${rateId}`, adminHeaders)
        fail("Expected 404")
      } catch (err: any) {
        expect(err.response.status).toBe(404)
      }
    })
  })
})
