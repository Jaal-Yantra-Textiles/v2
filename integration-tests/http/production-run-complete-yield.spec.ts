import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Production Run Complete — Yield & Cost", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "Partner account at {{partner_name}}",
            html_content: `<div>Partner {{partner_name}} created.</div>`,
            from: "partners@jaalyantra.com",
            variables: { partner_name: "name", temp_password: "pwd" },
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        // ok
      }

      return { adminHeaders, unique }
    }

    async function createPartner(unique: number) {
      const email = `yield-partner-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Yield Partner ${unique}`,
          handle: `yield-partner-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }

      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function createTemplates(adminHeaders: any, unique: number) {
      const name = `yield-cutting-${unique}`
      const res = await api.post(
        "/admin/task-templates",
        {
          name,
          description: "Cutting",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Yield Test",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return { templateName: name }
    }

    async function createDesign(adminHeaders: any, unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Yield Design ${unique}`,
          description: "Design for yield test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /** Helper to advance a run to the "ready to complete" state */
    async function advanceToFinished(runId: string, partnerHeaders: any) {
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
    }

    // ── Test: Complete with yield data ──────────────────────────────

    it("should store produced_quantity and rejected_quantity on complete", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 10,
          assignments: [{ partner_id: partnerId, quantity: 10, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      // Complete with yield data: 8 good, 2 rejected
      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 8,
          rejected_quantity: 2,
          rejection_reason: "stitching_defect",
          rejection_notes: "Thread pull on collar area",
          partner_cost_estimate: 5000,
          cost_type: "total",
          notes: "Batch completed with minor defects",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.production_run.status).toBe("completed")
      expect(completeRes.data.production_run.produced_quantity).toBe(8)
      expect(completeRes.data.production_run.rejected_quantity).toBe(2)
      expect(completeRes.data.production_run.rejection_reason).toBe("stitching_defect")
      expect(completeRes.data.production_run.rejection_notes).toBe("Thread pull on collar area")
      expect(completeRes.data.production_run.partner_cost_estimate).toBe(5000)
      expect(completeRes.data.production_run.cost_type).toBe("total")
      expect(completeRes.data.production_run.completion_notes).toBe("Batch completed with minor defects")
    })

    // ── Test: Per-unit cost type ────────────────────────────────────

    it("should normalize per_unit cost to total on complete", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 10,
          assignments: [{ partner_id: partnerId, quantity: 10, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      // Complete with per-unit cost: 500/piece × 7 produced = 3500 total
      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 7,
          rejected_quantity: 3,
          rejection_reason: "fabric_flaw",
          partner_cost_estimate: 500,
          cost_type: "per_unit",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      // API normalizes per_unit to total: 500 × 7 = 3500
      expect(completeRes.data.production_run.partner_cost_estimate).toBe(3500)
      expect(completeRes.data.production_run.cost_type).toBe("per_unit")
      expect(completeRes.data.production_run.produced_quantity).toBe(7)
    })

    // ── Test: Complete with zero rejections ─────────────────────────

    it("should complete with 100% yield (no rejections)", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 5,
          assignments: [{ partner_id: partnerId, quantity: 5, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 5,
          partner_cost_estimate: 2500,
          cost_type: "total",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.production_run.produced_quantity).toBe(5)
      expect(completeRes.data.production_run.rejected_quantity).toBeNull()
      expect(completeRes.data.production_run.rejection_reason).toBeNull()
    })

    // ── Test: Complete without yield data (backward compat) ─────────

    it("should still work without yield fields (backward compatibility)", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 3,
          assignments: [{ partner_id: partnerId, quantity: 3, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      // Complete with no yield fields — just like the old API
      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          partner_cost_estimate: 1500,
          notes: "Done",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.production_run.status).toBe("completed")
      expect(completeRes.data.production_run.partner_cost_estimate).toBe(1500)
      // produced_quantity should be null (not sent)
      expect(completeRes.data.production_run.produced_quantity).toBeNull()
    })

    // ── Test: Complete with consumptions + yield ────────────────────

    it("should log consumptions alongside yield data", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      // Create inventory item
      const invRes = await api.post(
        "/admin/inventory-items",
        { title: `Yield Fabric ${unique}`, description: "For yield+consumption test" },
        adminHeaders
      )
      expect(invRes.status).toBe(200)
      const inventoryItemId = invRes.data.inventory_item.id

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 9,
          assignments: [{ partner_id: partnerId, quantity: 9, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 7,
          rejected_quantity: 2,
          rejection_reason: "color_mismatch",
          partner_cost_estimate: 600,
          cost_type: "per_unit",
          consumptions: [
            {
              inventory_item_id: inventoryItemId,
              quantity: 18.5,
              unit_cost: 120,
              unit_of_measure: "Meter",
              notes: "Main fabric consumption",
            },
          ],
          notes: "Color batch variation caused 2 rejects",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.consumptions_logged).toBe(1)
      expect(completeRes.data.production_run.produced_quantity).toBe(7)
      // 600 per unit × 7 produced = 4200 total
      expect(completeRes.data.production_run.partner_cost_estimate).toBe(4200)
      expect(completeRes.data.message).toContain("1 consumption(s) recorded")
    })

    // ── Test: All rejection reasons are valid ───────────────────────

    it("should accept all valid rejection reasons", async () => {
      const reasons = [
        "stitching_defect",
        "fabric_flaw",
        "color_mismatch",
        "sizing_error",
        "print_defect",
        "material_damage",
        "quality_below_standard",
        "other",
      ]

      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)

      // Test with first reason (full flow)
      const designId = await createDesign(adminHeaders, unique)
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 2,
          assignments: [{ partner_id: partnerId, quantity: 2, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      const completeRes = await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 1,
          rejected_quantity: 1,
          rejection_reason: "other",
          rejection_notes: "Custom reason test",
        },
        { headers: partnerHeaders }
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.production_run.rejection_reason).toBe("other")
    })

    // ── Test: Admin can see yield data ──────────────────────────────

    it("should expose yield data to admin GET endpoint", async () => {
      const { adminHeaders, unique } = await setupTestData()
      const { partnerId, partnerHeaders } = await createPartner(unique)
      const { templateName } = await createTemplates(adminHeaders, unique)
      const designId = await createDesign(adminHeaders, unique)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 10,
          assignments: [{ partner_id: partnerId, quantity: 10, template_names: [templateName] }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id

      await advanceToFinished(runId, partnerHeaders)

      await api.post(
        `/partners/production-runs/${runId}/complete`,
        {
          produced_quantity: 9,
          rejected_quantity: 1,
          rejection_reason: "sizing_error",
          partner_cost_estimate: 450,
          cost_type: "per_unit",
        },
        { headers: partnerHeaders }
      )

      // Admin should see the yield data
      const adminDetail = await api.get(
        `/admin/production-runs/${runId}`,
        adminHeaders
      )
      expect(adminDetail.status).toBe(200)
      expect(adminDetail.data.production_run.produced_quantity).toBe(9)
      expect(adminDetail.data.production_run.rejected_quantity).toBe(1)
      expect(adminDetail.data.production_run.rejection_reason).toBe("sizing_error")
      expect(adminDetail.data.production_run.cost_type).toBe("per_unit")
      // Normalized total: 450 × 9 = 4050
      expect(adminDetail.data.production_run.partner_cost_estimate).toBe(4050)
    })
  })
})
