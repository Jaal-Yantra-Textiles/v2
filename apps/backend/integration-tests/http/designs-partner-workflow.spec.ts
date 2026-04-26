import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const TEST_PARTNER_EMAIL = "partner@design-workflow-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

// Keep a reasonable suite timeout
jest.setTimeout(60000)

setupSharedTestSuite(() => {
  describe("Partner Design Workflow - end to end", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: any
    let partnerHeaders: any
    let partnerId: string
    let designId: string

    // Lightweight debug logger for this suite
    const dbg = (label: string, payload: any) => {
      try {
        // Avoid massive dumps; stringify safely
        // eslint-disable-next-line no-console
        console.log(`[TEST DBG] ${label}:`, JSON.stringify(payload, null, 2))
      } catch {
        // eslint-disable-next-line no-console
        console.log(`[TEST DBG] ${label}:`, payload)
      }
    }

    // Helper: log current tasks for a design (title/status)
    const logDesignTaskSummary = async (designId: string) => {
      try {
        const res: any = await api.get(`/admin/designs/${designId}/tasks`, adminHeaders)
        const tasks: any[] = res.data?.tasks || []
        const summary = tasks.map((t: any) => ({ id: t?.id, title: t?.title, status: t?.status }))
        dbg("tasks.summary", summary)
      } catch (e: any) {
        dbg("tasks.summary.error", e?.message || e)
      }
    }

    // Helper: log available task templates and ensure redo child templates exist
    const logAndCheckRedoTemplates = async () => {
      try {
        const res: any = await api.get("/admin/task-templates", adminHeaders)
        const tpls: any[] = res.data?.task_templates || res.data?.task_templates || []
        const names = tpls.map((t: any) => t?.name).filter(Boolean)
        dbg("templates.names", names)
        const need = [
          "partner-design-redo-log",
          "partner-design-redo-apply",
          "partner-design-redo-verify",
        ]
        const present = need.every((n) => names.includes(n))
        if (!present) {
          // Provide an explicit test failure cause to surface root issue
          throw new Error(`Missing redo child templates. Required: ${need.join(", ")}. Got: ${names.join(", ")}`)
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[TEST DBG] templates.check.error:", e?.message || e)
        throw e
      }
    }

    // Helper: wait for redo child tasks to be present (bounded polling)
    const waitForRedoChildren = async (designId: string, attempts = 50, sleepMs = 100) => {
      const childTitles = [
        "partner-design-redo-log",
        "partner-design-redo-apply",
        "partner-design-redo-verify",
      ]
      for (let i = 0; i < attempts; i++) {
        const res: any = await api.get(`/admin/designs/${designId}/tasks`, adminHeaders)
        const tasks: any[] = res.data?.tasks || []
        const hasAll = childTitles.every((t) => tasks.some((x: any) => x?.title === t))
        dbg(`redo-children.poll[${i}]`, { hasAll, count: tasks.length })
        if (hasAll) return true
        await new Promise((r) => setTimeout(r, sleepMs))
      }
      // Final snapshot for debugging: list current task titles
      try {
        const res: any = await api.get(`/admin/designs/${designId}/tasks`, adminHeaders)
        const tasks: any[] = res.data?.tasks || []
        dbg("redo-children.final", { titles: tasks.map((t: any) => t?.title), count: tasks.length })
      } catch (e: any) {
        dbg("redo-children.final.error", e?.message || e)
      }
      return false
    }

    // No per-call timeouts; run as a normal integration spec

    const sampleDesign = {
      name: "Partner Workflow Test Design",
      description: "A design to test partner workflow",
      design_type: "Original",
      status: "Conceptual",
      priority: "High",
      target_completion_date: new Date().toISOString(),
      tags: ["test", "partner", "workflow"],
      color_palette: [
        { name: "Azure", code: "#007FFF" },
        { name: "Sand", code: "#C2B280" },
      ],
      estimated_cost: 1234,
      designer_notes: "Notes for manufacturing and testing",
      inspiration_sources: ["minimal", "utility"],
      design_files: ["d1.svg"],
      thumbnail_url: "https://example.com/t.png",
      custom_sizes: { S: { chest: 36, length: 28 } },
      metadata: { purpose: "integration-test" },
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Register and login partner admin
      await api.post("/auth/partner/emailpass/register", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })

      const partnerLoginResponse = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${partnerLoginResponse.data.token}` }

      // Create Partner linked to this partner admin
      const partnerPayload = {
        name: "Workflow Test Partner",
        handle: "workflow-test-partner",
        admin: {
          email: TEST_PARTNER_EMAIL,
          first_name: "Partner",
          last_name: "Admin",
        },
      }
      const partnerResponse: any = await api.post("/partners", partnerPayload, { headers: partnerHeaders })
      expect(partnerResponse.status).toBe(200)
      partnerId = partnerResponse.data.partner.id

      // Fresh token after partner creation (best practice in tests)
      const newAuth: any = await api.post("/auth/partner/emailpass", { email: TEST_PARTNER_EMAIL, password: TEST_PARTNER_PASSWORD })
      partnerHeaders = { Authorization: `Bearer ${newAuth.data.token}` }

      // Create partner design task templates required by the send-to-partner workflow
      const partnerDesignStartTemplate = {
        name: "partner-design-start", // identifier as name
        description: "Template for when a design is started by a partner",
        priority: "medium",
        estimated_duration: 30,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
          notes: { type: "text", required: false },
        },
        eventable: true,
        notifiable: true,
        message_template: "Design {{design_id}} has been started by partner.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "start",
        },
        category: "Partner Designs",
      }

      const partnerDesignRedoTemplate = {
        name: "partner-design-redo",
        description: "Template for when a partner requests redo",
        priority: "medium",
        estimated_duration: 30,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: true,
        notifiable: true,
        message_template: "Design {{design_id}} redo requested by partner.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "redo",
        },
        // category will be injected via category_id after first template creation
      }

      const partnerDesignFinishTemplate = {
        name: "partner-design-finish",
        description: "Template for when a partner marks design as finished",
        priority: "medium",
        estimated_duration: 60,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: true,
        notifiable: true,
        message_template: "Design {{design_id}} finished by partner.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "finish",
        },
      }

      const partnerDesignCompletedTemplate = {
        name: "partner-design-completed",
        description: "Template for when a partner marks design as completed",
        priority: "high",
        estimated_duration: 90,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: true,
        notifiable: true,
        message_template: "Design {{design_id}} completed by partner.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "completed",
        },
      }

      // Redo child templates for the redo sub-workflow
      const partnerDesignRedoLogTemplate = {
        name: "partner-design-redo-log",
        description: "Log redo feedback and changes",
        priority: "low",
        estimated_duration: 15,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: false,
        notifiable: false,
        message_template: "Redo log captured for design {{design_id}}.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "redo_log",
        },
      }

      const partnerDesignRedoApplyTemplate = {
        name: "partner-design-redo-apply",
        description: "Apply redo changes",
        priority: "medium",
        estimated_duration: 45,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: false,
        notifiable: false,
        message_template: "Redo changes applied for design {{design_id}}.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "redo_apply",
        },
      }

      const partnerDesignRedoVerifyTemplate = {
        name: "partner-design-redo-verify",
        description: "Verify redo changes",
        priority: "medium",
        estimated_duration: 30,
        required_fields: {
          design_id: { type: "string", required: true },
          partner_id: { type: "string", required: true },
        },
        eventable: false,
        notifiable: false,
        message_template: "Redo verification done for design {{design_id}}.",
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "redo_verify",
        },
      }

      // Create the first template to create the category
      const startTemplateRes: any = await api.post("/admin/task-templates", partnerDesignStartTemplate, adminHeaders)
      expect(startTemplateRes.status).toBe(201)
      const categoryId = startTemplateRes.data.task_template.category_id

      // Attach category_id to remaining templates and remove any category field
      const redoWithCat = { ...partnerDesignRedoTemplate, category_id: categoryId }
      const { category: _c1, ...redoClean } = redoWithCat as any

      const finishWithCat = { ...partnerDesignFinishTemplate, category_id: categoryId }
      const { category: _c2, ...finishClean } = finishWithCat as any

      const completedWithCat = { ...partnerDesignCompletedTemplate, category_id: categoryId }
      const { category: _c3, ...completedClean } = completedWithCat as any

      const redoLogWithCat = { ...partnerDesignRedoLogTemplate, category_id: categoryId }
      const { category: _c4, ...redoLogClean } = redoLogWithCat as any

      const redoApplyWithCat = { ...partnerDesignRedoApplyTemplate, category_id: categoryId }
      const { category: _c5, ...redoApplyClean } = redoApplyWithCat as any

      const redoVerifyWithCat = { ...partnerDesignRedoVerifyTemplate, category_id: categoryId }
      const { category: _c6, ...redoVerifyClean } = redoVerifyWithCat as any

      const redoTemplateRes: any = await api.post("/admin/task-templates", redoClean, adminHeaders)
      expect(redoTemplateRes.status).toBe(201)

      const finishTemplateRes: any = await api.post("/admin/task-templates", finishClean, adminHeaders)
      expect(finishTemplateRes.status).toBe(201)

      const completedTemplateRes: any = await api.post("/admin/task-templates", completedClean, adminHeaders)
      expect(completedTemplateRes.status).toBe(201)

      const redoLogTemplateRes: any = await api.post("/admin/task-templates", redoLogClean, adminHeaders)
      expect(redoLogTemplateRes.status).toBe(201)

      const redoApplyTemplateRes: any = await api.post("/admin/task-templates", redoApplyClean, adminHeaders)
      expect(redoApplyTemplateRes.status).toBe(201)

      const redoVerifyTemplateRes: any = await api.post("/admin/task-templates", redoVerifyClean, adminHeaders)
      expect(redoVerifyTemplateRes.status).toBe(201)

      // Optionally verify list
      const templatesList: any = await api.get("/admin/task-templates", adminHeaders)
      expect(templatesList.status).toBe(200)

      // Create a design via admin
      const createDesignRes: any = await api.post("/admin/designs", sampleDesign, adminHeaders)
      expect(createDesignRes.status).toBe(201)
      designId = createDesignRes.data.design.id

      // Ensure redo child templates are present before running workflow
      await logAndCheckRedoTemplates()

      // Send the design to partner
      const sendPayload = { partnerId, notes: "Please start work on this design" }
      const sendRes: any = await api.post(`/admin/designs/${designId}/send-to-partner`, sendPayload, adminHeaders)
      console.log("[TEST DBG] sendRes:", JSON.stringify({ status: sendRes.status, data: sendRes.data }, null, 2))
      expect(sendRes.status).toBe(200)
      expect(sendRes.data.message).toBe("Design sent to partner successfully")
      
      // No artificial waits; proceed directly
      await logDesignTaskSummary(designId)
    })

    

    it("should progress through start → finish → redo → complete and reflect statuses", async () => {
      // Initial listing for this partner should show assigned status
      const listInitial = await api.get("/partners/designs", { headers: partnerHeaders })
      dbg("listInitial.partner_info for design", (listInitial.data.designs || []).find((d: any) => d.id === designId)?.partner_info)
      expect(listInitial.status).toBe(200)
      const initialDesignNode = (listInitial.data.designs || []).find((d: any) => d.id === designId)
      expect(initialDesignNode?.partner_info?.partner_status).toBe("assigned")

      // Start
      const startRes = await api.post(`/partners/designs/${designId}/start`, {}, { headers: partnerHeaders })
      dbg("startRes", { status: startRes.status, data: startRes.data })
      expect(startRes.status).toBe(200)
      expect(startRes.data.message).toBe("Design started successfully")
      expect(startRes.data.design.status).toBe("In_Development")

      // Check listing reflects in_progress
      const listAfterStart = await api.get("/partners/designs", { headers: partnerHeaders })
      const afterStartNode = (listAfterStart.data.designs || []).find((d: any) => d.id === designId)
      dbg("afterStartNode.partner_info", afterStartNode?.partner_info)
      expect(afterStartNode?.partner_info?.partner_status).toBe("in_progress")

      // Finish (ready for inspection)
      const finishRes = await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
      dbg("finishRes", { status: finishRes.status, data: finishRes.data })
      expect(finishRes.status).toBe(200)
      expect(finishRes.data.message).toBe("Design marked as finished")
      expect(finishRes.data.design.status).toBe("Technical_Review")

      // Check listing reflects finished
      const listAfterFinish = await api.get("/partners/designs", { headers: partnerHeaders })
      const afterFinishNode = (listAfterFinish.data.designs || []).find((d: any) => d.id === designId)
      dbg("afterFinishNode.partner_info", afterFinishNode?.partner_info)
      expect(afterFinishNode?.partner_info?.partner_status).toBe("finished")

      // Redo (requested after inspection)
      const redoRes = await api.post(`/partners/designs/${designId}/redo`, {}, { headers: partnerHeaders })
      dbg("redoRes", { status: redoRes.status, data: redoRes.data })
      expect(redoRes.status).toBe(200)
      // Message may vary slightly; ensure it acknowledges redo and starting cycle
      expect(String(redoRes.data.message || "")).toMatch(/Redo acknowledged/i)

      // Single check for redo state (no polling sleeps)
      const listAfterRedo = await api.get("/partners/designs", { headers: partnerHeaders })
      const redoNode: any = (listAfterRedo.data.designs || []).find((d: any) => d.id === designId)
      dbg("redoNode.partner_info", redoNode?.partner_info)
      expect(redoNode?.partner_info?.partner_status).toBe("in_progress")
      expect(redoNode?.partner_info?.partner_phase).toBe("redo")

      // Wait briefly for redo child tasks to be created and linked
      {
        const ok = await waitForRedoChildren(designId)
        expect(ok).toBe(true)
      }

      // Re-finish during redo before completing (required by workflow)
      const refinishRes = await api.post(`/partners/designs/${designId}/refinish`, {}, { headers: partnerHeaders })
      // Optional debug
      // eslint-disable-next-line no-console
      console.log(`[TEST DBG] refinishRes:`, JSON.stringify({ status: refinishRes.status, data: refinishRes.data }, null, 2))
      expect(refinishRes.status).toBe(200)
      expect(String(refinishRes.data.message || "")).toMatch(/re-finished/i)

      // Ensure listing reflects finished again before completing
      const listAfterRefinish = await api.get("/partners/designs", { headers: partnerHeaders })
      const postRefinishNode: any = (listAfterRefinish.data.designs || []).find((d: any) => d.id === designId)
      dbg("postRefinishNode.partner_info", postRefinishNode?.partner_info)
      expect(postRefinishNode?.partner_info?.partner_status).toBe("finished")

      // Complete (can pass consumptions directly now; using empty to rely on defaults/no-op)
      const completeRes = await api.post(
        `/partners/designs/${designId}/complete`,
        { consumptions: [] },
        { headers: partnerHeaders }
      )
      dbg("completeRes", { status: completeRes.status, data: completeRes.data })
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.message).toBe("Design marked as completed")
      expect(completeRes.data.design.status).toBe("Approved")

      const listFinal = await api.get("/partners/designs", { headers: partnerHeaders })
      const finalNode: any = (listFinal.data.designs || []).find((d: any) => d.id === designId)
      dbg("finalNode.partner_info", finalNode?.partner_info)
      expect(finalNode?.partner_info?.partner_status).toBe("completed")
    })

    it("should support redo sub-workflow cycle: finish → redo → re-finish → complete", async () => {
      // Start
      const startRes = await api.post(`/partners/designs/${designId}/start`, {}, { headers: partnerHeaders })
      dbg("startRes.2", { status: startRes.status, data: startRes.data })
      expect(startRes.status).toBe(200)
      await logDesignTaskSummary(designId)

      // Finish (ready for inspection)
      const finishRes1 = await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
      dbg("finishRes1", { status: finishRes1.status, data: finishRes1.data })
      expect(finishRes1.status).toBe(200)
      expect(finishRes1.data.message).toBe("Design marked as finished")
      await logDesignTaskSummary(designId)

      // Trigger redo (enters redo sub-workflow via await-design-redo)
      const redoRes = await api.post(`/partners/designs/${designId}/redo`, {}, { headers: partnerHeaders })
      dbg("redoRes.2", { status: redoRes.status, data: redoRes.data })
      expect(redoRes.status).toBe(200)
      // Message may vary slightly; ensure it acknowledges redo and starting cycle
      expect(String(redoRes.data.message || "")).toMatch(/Redo acknowledged/i)
      await logDesignTaskSummary(designId)

      // Confirm templates are still present before waiting for child tasks
      await logAndCheckRedoTemplates()

      // Immediate check for redo state (no polling)
      {
        const listAfterRedo = await api.get("/partners/designs", { headers: partnerHeaders })
        const redoNode: any = (listAfterRedo.data.designs || []).find((d: any) => d.id === designId)
        dbg("redoNode.partner_info", redoNode?.partner_info)
        expect(redoNode?.partner_info?.partner_status).toBe("in_progress")
        expect(redoNode?.partner_info?.partner_phase).toBe("redo")
      }

      // Re-finish during redo (use refinish endpoint)
      const refinishRes2 = await api.post(`/partners/designs/${designId}/refinish`, {}, { headers: partnerHeaders })
      dbg("refinishRes2", { status: refinishRes2.status, data: refinishRes2.data })
      expect(refinishRes2.status).toBe(200)
      expect(String(refinishRes2.data.message || "")).toMatch(/re-finished/i)
      await logDesignTaskSummary(designId)

      // Immediate check for finished status
      {
        const listAfterRefinish2 = await api.get("/partners/designs", { headers: partnerHeaders })
        const postRefinishNode2: any = (listAfterRefinish2.data.designs || []).find((d: any) => d.id === designId)
        dbg("postRefinishNode2.partner_info", postRefinishNode2?.partner_info)
        expect(postRefinishNode2?.partner_info?.partner_status).toBe("finished")
      }

      // Complete directly (inventory consumptions can be provided here if needed)
      const completeRes = await api.post(
        `/partners/designs/${designId}/complete`,
        { consumptions: [] },
        { headers: partnerHeaders }
      )
      dbg("completeRes.2", { status: completeRes.status, data: completeRes.data })
      expect(completeRes.status).toBe(200)
      await logDesignTaskSummary(designId)

      // Immediate check for completed status
      {
        const listFinal = await api.get("/partners/designs", { headers: partnerHeaders })
        const finalNode: any = (listFinal.data.designs || []).find((d: any) => d.id === designId)
        dbg("finalNode.partner_info", finalNode?.partner_info)
        expect(finalNode?.partner_info?.partner_status).toBe("completed")
      }

    })
  })
})
