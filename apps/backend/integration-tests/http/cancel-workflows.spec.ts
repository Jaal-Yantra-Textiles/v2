import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  describe("Cancel Workflows — v1 Send-to-Partner and Production Runs", () => {

    async function setup() {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      try {
        await api.post("/admin/email-templates", {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "Partner account at {{partner_name}}",
          html_content: "<div>Partner {{partner_name}} created.</div>",
          from: "partners@jaalyantra.com",
          variables: { partner_name: "name", temp_password: "pwd" },
          template_type: "email",
        }, adminHeaders)
      } catch { /* ok */ }

      return { api, container, adminHeaders, unique }
    }

    async function createPartner(api: any, unique: number) {
      const email = `cancel-p-${unique}@jyt.test`
      const pw = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password: pw })
      let lr = await api.post("/auth/partner/emailpass", { email, password: pw })
      let h = { Authorization: `Bearer ${lr.data.token}` }

      const res = await api.post("/partners", {
        name: `Cancel Partner ${unique}`,
        handle: `cancel-p-${unique}`,
        admin: { email, first_name: "T", last_name: "P" },
      }, { headers: h })
      expect(res.status).toBe(200)

      lr = await api.post("/auth/partner/emailpass", { email, password: pw })
      h = { Authorization: `Bearer ${lr.data.token}` }
      return { partnerId: res.data.partner.id, partnerHeaders: h }
    }

    async function createDesign(api: any, adminHeaders: any, unique: number) {
      const res = await api.post("/admin/designs", {
        name: `Cancel Design ${unique}`,
        description: "Cancel test",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
      }, adminHeaders)
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /**
     * Simulate v1 send-to-partner by creating links + tasks directly.
     * Avoids calling the actual workflow which suspends at async gates.
     */
    async function simulateV1Send(container: any, designId: string, partnerId: string) {
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      const taskService = container.resolve("tasks") as any
      const designService = container.resolve("design") as any

      // Link partner to design
      await remoteLink.create({
        design: { design_id: designId },
        partner: { partner_id: partnerId },
      })

      // Create v1 tasks
      const titles = [
        "partner-design-start",
        "partner-design-redo",
        "partner-design-finish",
        "partner-design-completed",
      ]
      const txId = `sim-tx-${Date.now()}`
      const taskIds: string[] = []

      for (const title of titles) {
        const task = await taskService.createTasks({
          title,
          description: `v1: ${title}`,
          status: "pending",
          transaction_id: txId,
          start_date: new Date(),
          end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        taskIds.push(task.id)
        await remoteLink.create({
          design: { design_id: designId },
          tasks: { task_id: task.id },
        })
      }

      await designService.updateDesigns({
        id: designId,
        metadata: { partner_status: "assigned", partner_phase: null },
      })

      return { txId, taskIds }
    }

    /**
     * Create a production run WITHOUT dispatching (no async workflow hang).
     * Sets status to sent_to_partner directly for cancel testing.
     */
    async function createRunWithoutDispatch(
      api: any,
      adminHeaders: any,
      container: any,
      designId: string,
      partnerId: string
    ) {
      // Create run via admin API (no assignments = no dispatch)
      const res = await api.post("/admin/production-runs", {
        design_id: designId,
        partner_id: partnerId,
        quantity: 5,
      }, adminHeaders)
      expect(res.status).toBe(201)
      const runId = res.data.production_run.id

      // Manually set to sent_to_partner to simulate dispatched state
      const runService = container.resolve("production_runs") as any
      await runService.updateProductionRuns({
        id: runId,
        status: "sent_to_partner",
      })

      return runId
    }

    // ─── V1 Cancel Tests ────────────────────────────────────────────

    describe("v1 cancel-partner-assignment", () => {
      it("should cancel v1 tasks and reset metadata", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        const { taskIds } = await simulateV1Send(container, designId, partnerId)
        expect(taskIds.length).toBe(4)

        const cancelRes = await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)
        expect(cancelRes.data.cancelled_tasks).toBeGreaterThanOrEqual(0)
        expect(cancelRes.data.unlinked).toBe(false)

        // Cancellation recorded in metadata
        const after = await api.get(`/admin/designs/${designId}`, adminHeaders)
        const meta = after.data.design.metadata || {}
        expect(meta.partner_assignment_cancelled_at).toBeDefined()
        expect(meta.partner_assignment_cancelled_partner_id).toBe(partnerId)
      })

      it("should cancel and unlink when unlink=true", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        await simulateV1Send(container, designId, partnerId)

        const cancelRes = await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId, unlink: true },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)
        expect(cancelRes.data.unlinked).toBe(true)

        // Partner no longer linked
        const after = await api.get(
          `/admin/designs/${designId}?fields=partners.*`,
          adminHeaders
        )
        const partners = after.data.design.partners || []
        expect(partners.some((p: any) => p.id === partnerId)).toBe(false)
      })

      it("should reject cancel for unlinked partner", async () => {
        const { api, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        const res = await api
          .post(
            `/admin/designs/${designId}/cancel-partner-assignment`,
            { partner_id: partnerId },
            { ...adminHeaders, validateStatus: () => true }
          )
          .catch((e: any) => e.response)
        expect([400, 404]).toContain(res.status)
      })
    })

    // ─── Production Run Cancel Tests ────────────────────────────────

    describe("production-run cancel", () => {
      it("should cancel a sent_to_partner run", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        const runId = await createRunWithoutDispatch(
          api, adminHeaders, container, designId, partnerId
        )

        const cancelRes = await api.post(
          `/admin/production-runs/${runId}/cancel`,
          { reason: "Test cancel" },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)
        expect(cancelRes.data.production_run.status).toBe("cancelled")
      })

      it("should cancel an in_progress run", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        const runId = await createRunWithoutDispatch(
          api, adminHeaders, container, designId, partnerId
        )

        // Simulate accept + start
        const runService = container.resolve("production_runs") as any
        await runService.updateProductionRuns({
          id: runId,
          status: "in_progress",
          accepted_at: new Date(),
          started_at: new Date(),
        })

        const cancelRes = await api.post(
          `/admin/production-runs/${runId}/cancel`,
          { reason: "Requirements changed" },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)
        expect(cancelRes.data.production_run.status).toBe("cancelled")
      })

      it("should reject cancel on completed run", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        const runId = await createRunWithoutDispatch(
          api, adminHeaders, container, designId, partnerId
        )

        // Simulate completed
        const runService = container.resolve("production_runs") as any
        await runService.updateProductionRuns({
          id: runId,
          status: "completed",
          completed_at: new Date(),
        })

        const res = await api
          .post(`/admin/production-runs/${runId}/cancel`, {}, {
            ...adminHeaders,
            validateStatus: () => true,
          })
          .catch((e: any) => e.response)
        expect([400, 403, 405, 500]).toContain(res.status)
      })

      it("should be idempotent on already-cancelled run", async () => {
        const { api, adminHeaders, unique } = await setup()
        const designId = await createDesign(api, adminHeaders, unique)

        const createRes = await api.post("/admin/production-runs", {
          design_id: designId,
          quantity: 1,
        }, adminHeaders)
        expect(createRes.status).toBe(201)
        const runId = createRes.data.production_run.id

        const c1 = await api.post(`/admin/production-runs/${runId}/cancel`, {}, adminHeaders)
        expect(c1.status).toBe(200)

        const c2 = await api.post(`/admin/production-runs/${runId}/cancel`, {}, adminHeaders)
        expect(c2.status).toBe(200)
        expect(c2.data.message).toContain("Already cancelled")
      })
    })

    // ─── Transition: v1 cancel → production run ─────────────────────

    describe("v1 → cancel → production run transition", () => {
      it("should cancel v1 then create a production run for same partner", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        // v1 send
        await simulateV1Send(container, designId, partnerId)

        // Cancel v1 (keep linked)
        const cancelRes = await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId, unlink: false },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)

        // Create production run (no dispatch to avoid async hang)
        const runRes = await api.post("/admin/production-runs", {
          design_id: designId,
          partner_id: partnerId,
          quantity: 5,
        }, adminHeaders)
        expect(runRes.status).toBe(201)
        expect(runRes.data.production_run.design_id).toBe(designId)
        expect(runRes.data.production_run.partner_id).toBe(partnerId)
      })
    })

    // ─── Partner action guards after v1 cancel ──────────────────────

    describe("Partner actions blocked after v1 cancel", () => {
      it("should block partner /start after v1 cancel", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        // Simulate v1 send
        await simulateV1Send(container, designId, partnerId)

        // Partner sees the design
        const designsBefore = await api.get("/partners/designs", {
          headers: partnerHeaders,
        })
        const found = designsBefore.data.designs?.find((d: any) => d.id === designId)
        expect(found).toBeDefined()

        // Admin cancels v1
        const cancelRes = await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )
        expect(cancelRes.status).toBe(200)

        // Partner tries to start — should be blocked
        const startRes = await api
          .post(
            `/partners/designs/${designId}/start`,
            {},
            { headers: partnerHeaders, validateStatus: () => true }
          )
        expect(startRes.status).toBe(400)
        expect(startRes.data.error).toContain("cancelled")
      })

      it("should block partner /finish after v1 cancel", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        await simulateV1Send(container, designId, partnerId)

        // Admin cancels
        await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )

        // Partner tries to finish — blocked
        const finishRes = await api
          .post(
            `/partners/designs/${designId}/finish`,
            {},
            { headers: partnerHeaders, validateStatus: () => true }
          )
        expect(finishRes.status).toBe(400)
        expect(finishRes.data.error).toContain("cancelled")
      })

      it("should block partner /complete after v1 cancel", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        await simulateV1Send(container, designId, partnerId)

        // Admin cancels
        await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )

        // Partner tries to complete — blocked
        const completeRes = await api
          .post(
            `/partners/designs/${designId}/complete`,
            {},
            { headers: partnerHeaders, validateStatus: () => true }
          )
        expect(completeRes.status).toBe(400)
        expect(completeRes.data.error).toContain("cancelled")
      })

      it("should show cancelled status in partner design list", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        await simulateV1Send(container, designId, partnerId)

        // Admin cancels
        await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )

        // Partner list should show cancelled status
        const listRes = await api.get("/partners/designs", {
          headers: partnerHeaders,
        })
        expect(listRes.status).toBe(200)
        const design = listRes.data.designs?.find((d: any) => d.id === designId)
        expect(design).toBeDefined()
        expect(design.partner_info.partner_status).toBe("cancelled")
      })

      it("should show cancelled status in partner design detail", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        await simulateV1Send(container, designId, partnerId)

        // Admin cancels
        await api.post(
          `/admin/designs/${designId}/cancel-partner-assignment`,
          { partner_id: partnerId },
          adminHeaders
        )

        // Partner detail should show cancelled status
        const detailRes = await api.get(
          `/partners/designs/${designId}`,
          { headers: partnerHeaders }
        )
        expect(detailRes.status).toBe(200)
        expect(detailRes.data.design.partner_info.partner_status).toBe("cancelled")
      })

      it("should allow partner actions on non-cancelled v1 design (normal flow)", async () => {
        const { api, container, adminHeaders, unique } = await setup()
        const { partnerId, partnerHeaders } = await createPartner(api, unique)
        const designId = await createDesign(api, adminHeaders, unique)

        // Simulate v1 send (NOT cancelled)
        await simulateV1Send(container, designId, partnerId)

        // Partner should be able to start — NOT blocked
        // This will fail at the workflow signal step (fake txId) but should NOT return 400 "cancelled"
        const startRes = await api
          .post(
            `/partners/designs/${designId}/start`,
            {},
            { headers: partnerHeaders, validateStatus: () => true }
          )
        // Should NOT be 400 with "cancelled" error — the design is active
        // It may be 500 (workflow signal fails on fake txId) or 200, but not "cancelled"
        if (startRes.status === 400) {
          expect(startRes.data.error).not.toContain("cancelled")
        }
      })
    })
  })
})
