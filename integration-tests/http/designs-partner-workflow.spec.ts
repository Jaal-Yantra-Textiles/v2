import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const TEST_PARTNER_EMAIL = "partner@design-workflow-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

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
      const partnerResponse = await api.post("/partners", partnerPayload, {
        headers: partnerHeaders,
      })
      expect(partnerResponse.status).toBe(200)
      partnerId = partnerResponse.data.partner.id

      // Fresh token after partner creation (best practice in tests)
      const newAuth = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
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

      // Create the first template to create the category
      const startTemplateRes = await api.post("/admin/task-templates", partnerDesignStartTemplate, adminHeaders)
      expect(startTemplateRes.status).toBe(201)
      const categoryId = startTemplateRes.data.task_template.category_id

      // Attach category_id to remaining templates and remove any category field
      const redoWithCat = { ...partnerDesignRedoTemplate, category_id: categoryId }
      const { category: _c1, ...redoClean } = redoWithCat as any

      const finishWithCat = { ...partnerDesignFinishTemplate, category_id: categoryId }
      const { category: _c2, ...finishClean } = finishWithCat as any

      const completedWithCat = { ...partnerDesignCompletedTemplate, category_id: categoryId }
      const { category: _c3, ...completedClean } = completedWithCat as any

      const redoTemplateRes = await api.post("/admin/task-templates", redoClean, adminHeaders)
      expect(redoTemplateRes.status).toBe(201)

      const finishTemplateRes = await api.post("/admin/task-templates", finishClean, adminHeaders)
      expect(finishTemplateRes.status).toBe(201)

      const completedTemplateRes = await api.post("/admin/task-templates", completedClean, adminHeaders)
      expect(completedTemplateRes.status).toBe(201)

      // Optionally verify list
      const templatesList = await api.get("/admin/task-templates", adminHeaders)
      expect(templatesList.status).toBe(200)

      // Create a design via admin
      const createDesignRes = await api.post("/admin/designs", sampleDesign, adminHeaders)
      expect(createDesignRes.status).toBe(201)
      designId = createDesignRes.data.design.id

      // Send the design to partner
      const sendPayload = { partnerId, notes: "Please start work on this design" }
      const sendRes = await api.post(`/admin/designs/${designId}/send-to-partner`, sendPayload, adminHeaders)
      expect(sendRes.status).toBe(200)
      expect(sendRes.data.message).toBe("Design sent to partner successfully")

      // Small wait to allow workflow to create tasks
      await new Promise((r) => setTimeout(r, 500))
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

      // Wait until listing reflects redo (async propagation)
      let redoNode: any
      for (let i = 0; i < 20; i++) {
        const listAfterRedo = await api.get("/partners/designs", { headers: partnerHeaders })
        redoNode = (listAfterRedo.data.designs || []).find((d: any) => d.id === designId)
        dbg(`poll[${i}] redoNode.partner_info`, redoNode?.partner_info)
        if (
          redoNode?.partner_info?.partner_status === "in_progress" &&
          redoNode?.partner_info?.partner_phase === "redo"
        ) {
          break
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(redoNode?.partner_info?.partner_status).toBe("in_progress")
      expect(redoNode?.partner_info?.partner_phase).toBe("redo")

      // Small delay to allow engine to register await-design-refinish gate
      await new Promise((r) => setTimeout(r, 300))

      // Re-finish during redo before completing (required by workflow)
      const refinishRes = await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
      // Optional debug
      // eslint-disable-next-line no-console
      console.log(`[TEST DBG] refinishRes:`, JSON.stringify({ status: refinishRes.status, data: refinishRes.data }, null, 2))
      expect(refinishRes.status).toBe(200)
      expect(refinishRes.data.message).toBe("Design marked as finished")

      // Ensure listing reflects finished again before completing
      let postRefinishNode: any
      for (let i = 0; i < 10; i++) {
        const listAfterRefinish = await api.get("/partners/designs", { headers: partnerHeaders })
        postRefinishNode = (listAfterRefinish.data.designs || []).find((d: any) => d.id === designId)
        dbg(`poll[refinish ${i}] postRefinishNode.partner_info`, postRefinishNode?.partner_info)
        if (postRefinishNode?.partner_info?.partner_status === "finished") break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(postRefinishNode?.partner_info?.partner_status).toBe("finished")

      // Complete
      const completeRes = await api.post(`/partners/designs/${designId}/complete`, {}, { headers: partnerHeaders })
      dbg("completeRes", { status: completeRes.status, data: completeRes.data })
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.message).toBe("Design marked as completed")
      expect(completeRes.data.design.status).toBe("Approved")

      // Poll a bit since workflow signaling is async to reflect completed
      let finalNode: any
      for (let i = 0; i < 20; i++) {
        const listFinal = await api.get("/partners/designs", { headers: partnerHeaders })
        finalNode = (listFinal.data.designs || []).find((d: any) => d.id === designId)
        dbg(`poll[${i}] finalNode.partner_info`, finalNode?.partner_info)
        if (finalNode?.partner_info?.partner_status === "completed") break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(finalNode?.partner_info?.partner_status).toBe("completed")
    })

    // it("should support redo sub-workflow cycle: finish → redo → re-finish → complete", async () => {
    //   // Start
    //   const startRes = await api.post(`/partners/designs/${designId}/start`, {}, { headers: partnerHeaders })
    //   dbg("startRes.2", { status: startRes.status, data: startRes.data })
    //   expect(startRes.status).toBe(200)

    //   // Finish (ready for inspection)
    //   const finishRes1 = await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
    //   dbg("finishRes1", { status: finishRes1.status, data: finishRes1.data })
    //   expect(finishRes1.status).toBe(200)
    //   expect(finishRes1.data.message).toBe("Design marked as finished")

    //   // Trigger redo (enters redo sub-workflow via await-design-redo)
    //   const redoRes = await api.post(`/partners/designs/${designId}/redo`, {}, { headers: partnerHeaders })
    //   dbg("redoRes.2", { status: redoRes.status, data: redoRes.data })
    //   expect(redoRes.status).toBe(200)
    //   // Message may vary slightly; ensure it acknowledges redo and starting cycle
    //   expect(String(redoRes.data.message || "")).toMatch(/Redo acknowledged/i)

    //   // Poll partner listing until redo state is visible (in_progress + phase=redo)
    //   let redoNode: any
    //   for (let i = 0; i < 25; i++) {
    //     const listAfterRedo = await api.get("/partners/designs", { headers: partnerHeaders })
    //     redoNode = (listAfterRedo.data.designs || []).find((d: any) => d.id === designId)
    //     dbg(`poll2[${i}] redoNode.partner_info`, redoNode?.partner_info)
    //     if (
    //       redoNode?.partner_info?.partner_status === "in_progress" &&
    //       redoNode?.partner_info?.partner_phase === "redo"
    //     ) {
    //       break
    //     }
    //     await new Promise((r) => setTimeout(r, 200))
    //   }
    //   expect(redoNode?.partner_info?.partner_status).toBe("in_progress")
    //   expect(redoNode?.partner_info?.partner_phase).toBe("redo")

    //   // Small delay to allow engine to register await-design-refinish gate
    //   await new Promise((r) => setTimeout(r, 300))

    //   // Re-finish during redo
    //   const finishRes2 = await api.post(`/partners/designs/${designId}/finish`, {}, { headers: partnerHeaders })
    //   dbg("finishRes2", { status: finishRes2.status, data: finishRes2.data })
    //   expect(finishRes2.status).toBe(200)
    //   expect(finishRes2.data.message).toBe("Design marked as finished")

    //   // Ensure listing reflects finished before completing
    //   let postRefinishNode2: any
    //   for (let i = 0; i < 10; i++) {
    //     const listAfterRefinish2 = await api.get("/partners/designs", { headers: partnerHeaders })
    //     postRefinishNode2 = (listAfterRefinish2.data.designs || []).find((d: any) => d.id === designId)
    //     dbg(`poll2[refinish ${i}] postRefinishNode.partner_info`, postRefinishNode2?.partner_info)
    //     if (postRefinishNode2?.partner_info?.partner_status === "finished") break
    //     await new Promise((r) => setTimeout(r, 200))
    //   }
    //   expect(postRefinishNode2?.partner_info?.partner_status).toBe("finished")

    //   // Complete
    //   const completeRes = await api.post(`/partners/designs/${designId}/complete`, {}, { headers: partnerHeaders })
    //   dbg("completeRes.2", { status: completeRes.status, data: completeRes.data })
    //   expect(completeRes.status).toBe(200)

    //   // Poll until completed is reflected
    //   let finalNode: any
    //   for (let i = 0; i < 25; i++) {
    //     const listFinal = await api.get("/partners/designs", { headers: partnerHeaders })
    //     finalNode = (listFinal.data.designs || []).find((d: any) => d.id === designId)
    //     dbg(`poll2[${i}] finalNode.partner_info`, finalNode?.partner_info)
    //     if (finalNode?.partner_info?.partner_status === "completed") break
    //     await new Promise((r) => setTimeout(r, 200))
    //   }
    //   expect(finalNode?.partner_info?.partner_status).toBe("completed")
    // })
  })
})
