import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

setupSharedTestSuite(() => {
  describe("Production Runs - Cross-Run Ordering", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerAId: string
    let partnerAHeaders: { headers: Record<string, string> }
    let partnerBId: string
    let partnerBHeaders: { headers: Record<string, string> }
    let designId: string
    let templateCategoryId: string

    const logAxiosErr = (label: string, err: any) => {
      const res = err?.response
      console.log(`[TEST ERROR] ${label}`)
      console.log(
        JSON.stringify(
          {
            status: res?.status,
            url: res?.config?.url,
            method: res?.config?.method,
            data: res?.data,
          },
          null,
          2
        )
      )
    }

    const waitFor = async (
      fn: () => Promise<boolean>,
      {
        timeoutMs = 10_000,
        intervalMs = 500,
      }: { timeoutMs?: number; intervalMs?: number } = {}
    ) => {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        const ok = await fn()
        if (ok) return
        await new Promise((r) => setTimeout(r, intervalMs))
      }
      throw new Error(`Timed out after ${timeoutMs}ms`)
    }

    const createPartner = async (api: any, name: string, unique: number) => {
      const email = `${name}-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", {
        email,
        password,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password,
      })

      const createRes = await api.post(
        "/partners",
        {
          name: `${name} ${unique}`,
          handle: `${name}-${unique}`,
          admin: {
            email,
            first_name: name,
            last_name: "Partner",
          },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )

      expect(createRes.status).toBe(200)

      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password,
      })

      return {
        id: createRes.data.partner.id,
        headers: { headers: { Authorization: `Bearer ${login2.data.token}` } },
      }
    }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // Create email template (ignore if exists)
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "You're invited to set up your partner account at {{partner_name}}",
            html_content: `<div>Partner {{partner_name}} created. Temp password: {{temp_password}}</div>`,
            from: "partners@jaalyantra.com",
            variables: {
              partner_name: "Partner display name",
              temp_password: "Temporary password issued to the partner admin",
            },
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        // ok
      }

      const unique = Date.now()

      // Create two partners
      const partnerA = await createPartner(api, "weaving-partner", unique)
      partnerAId = partnerA.id
      partnerAHeaders = partnerA.headers

      const partnerB = await createPartner(api, "tailoring-partner", unique)
      partnerBId = partnerB.id
      partnerBHeaders = partnerB.headers

      // Create design
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Cross-Order Design ${unique}`,
          description: "Design for cross-run ordering test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          metadata: { moodboard: { source: "test" } },
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id

      // Create task templates
      const t1 = await api.post(
        "/admin/task-templates",
        {
          name: `weave-fabric-${unique}`,
          description: "Weave fabric step",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run", step: "weave" },
          category: "Production",
        },
        adminHeaders
      )
      expect(t1.status).toBe(201)
      templateCategoryId = t1.data.task_template.category_id

      const t2 = await api.post(
        "/admin/task-templates",
        {
          name: `stitch-garment-${unique}`,
          description: "Stitch garment step",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run", step: "stitch" },
          category_id: templateCategoryId,
        },
        adminHeaders
      )
      expect(t2.status).toBe(201)
    })

    it("should enforce cross-run ordering for multi-location workflows", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now()
      const weaveTemplateName = `weave-fabric-${unique}`
      const stitchTemplateName = `stitch-garment-${unique}`

      // Create unique templates for this test
      const t1 = await api.post(
        "/admin/task-templates",
        {
          name: weaveTemplateName,
          description: "Weave fabric",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category_id: templateCategoryId,
        },
        adminHeaders
      )
      expect(t1.status).toBe(201)

      const t2 = await api.post(
        "/admin/task-templates",
        {
          name: stitchTemplateName,
          description: "Stitch garment",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category_id: templateCategoryId,
        },
        adminHeaders
      )
      expect(t2.status).toBe(201)

      // 1) Create parent production run
      const createRunRes = await api
        .post(
          "/admin/production-runs",
          { design_id: designId, quantity: 10 },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr("POST /admin/production-runs", err)
          throw err
        })

      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      // 2) Approve with ordered assignments
      const approveRes = await api
        .post(
          `/admin/production-runs/${parentRunId}/approve`,
          {
            assignments: [
              {
                partner_id: partnerAId,
                role: "weaving",
                order: 1,
                template_names: [weaveTemplateName],
              },
              {
                partner_id: partnerBId,
                role: "tailoring",
                order: 2,
                template_names: [stitchTemplateName],
              },
            ],
          },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(`POST /admin/production-runs/${parentRunId}/approve`, err)
          throw err
        })

      expect(approveRes.status).toBe(200)
      const children = approveRes.data.result?.children || []
      expect(children.length).toBe(2)

      const childA = children.find((c: any) => c.partner_id === partnerAId)
      const childB = children.find((c: any) => c.partner_id === partnerBId)
      expect(childA).toBeTruthy()
      expect(childB).toBeTruthy()

      // 3) Assert child run B depends on child run A
      expect(childA.depends_on_run_ids).toBeNull()
      expect(childB.depends_on_run_ids).toEqual([childA.id])

      // 4) Attempt to dispatch child B → should fail (dependency unmet)
      try {
        await api.post(
          `/admin/production-runs/${childB.id}/start-dispatch`,
          {},
          adminHeaders
        )
        fail("Expected dispatch of child B to fail due to unmet dependency")
      } catch (err: any) {
        expect(err.response.status).toBe(400)
      }

      // 5) Dispatch child run A (start + resume with template)
      const startDispatchA = await api
        .post(
          `/admin/production-runs/${childA.id}/start-dispatch`,
          {},
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(`POST /admin/production-runs/${childA.id}/start-dispatch`, err)
          throw err
        })

      expect(startDispatchA.status).toBe(202)
      const txIdA = startDispatchA.data.transaction_id

      const resumeA = await api
        .post(
          `/admin/production-runs/${childA.id}/resume-dispatch`,
          {
            transaction_id: txIdA,
            template_names: [weaveTemplateName],
          },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(`POST /admin/production-runs/${childA.id}/resume-dispatch`, err)
          throw err
        })

      expect(resumeA.status).toBe(200)

      // Wait until child A is sent_to_partner
      await waitFor(async () => {
        const res = await api.get(`/admin/production-runs/${childA.id}`, adminHeaders)
        return String(res.data.production_run?.status) === "sent_to_partner"
      })

      // 6) Partner A accepts and finishes tasks
      await api
        .post(`/partners/production-runs/${childA.id}/accept`, {}, partnerAHeaders)
        .catch((err: any) => {
          logAxiosErr(`POST /partners/production-runs/${childA.id}/accept`, err)
          throw err
        })

      // Get tasks for child A and complete them
      const childARunRes = await api.get(`/admin/production-runs/${childA.id}`, adminHeaders)
      const childATasks = (childARunRes.data.tasks || []).filter(
        (t: any) => t.title === weaveTemplateName
      )

      for (const t of childATasks) {
        await api
          .post(`/partners/assigned-tasks/${t.id}/finish`, {}, partnerAHeaders)
          .catch((err: any) => {
            logAxiosErr(`POST /partners/assigned-tasks/${t.id}/finish`, err)
            throw err
          })
      }

      // 7) Wait for child run B to be auto-dispatched (sent_to_partner)
      await waitFor(
        async () => {
          const res = await api.get(`/admin/production-runs/${childB.id}`, adminHeaders)
          return String(res.data.production_run?.status) === "sent_to_partner"
        },
        { timeoutMs: 15_000 }
      )

      // 8) Partner B accepts and finishes tasks
      await api
        .post(`/partners/production-runs/${childB.id}/accept`, {}, partnerBHeaders)
        .catch((err: any) => {
          logAxiosErr(`POST /partners/production-runs/${childB.id}/accept`, err)
          throw err
        })

      const childBRunRes = await api.get(`/admin/production-runs/${childB.id}`, adminHeaders)
      const childBTasks = (childBRunRes.data.tasks || []).filter(
        (t: any) => t.title === stitchTemplateName
      )

      for (const t of childBTasks) {
        await api
          .post(`/partners/assigned-tasks/${t.id}/finish`, {}, partnerBHeaders)
          .catch((err: any) => {
            logAxiosErr(`POST /partners/assigned-tasks/${t.id}/finish`, err)
            throw err
          })
      }

      // 9) Wait for parent run to auto-complete
      await waitFor(
        async () => {
          const res = await api.get(`/admin/production-runs/${parentRunId}`, adminHeaders)
          return String(res.data.production_run?.status) === "completed"
        },
        { timeoutMs: 15_000 }
      )
    })

    it("should allow independent dispatch when no ordering specified", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now()

      // 1) Create parent production run
      const createRunRes = await api
        .post(
          "/admin/production-runs",
          { design_id: designId, quantity: 10 },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr("POST /admin/production-runs (no-order)", err)
          throw err
        })

      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      // 2) Approve WITHOUT order field
      const approveRes = await api
        .post(
          `/admin/production-runs/${parentRunId}/approve`,
          {
            assignments: [
              { partner_id: partnerAId, role: "weaving" },
              { partner_id: partnerBId, role: "tailoring" },
            ],
          },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(`POST /admin/production-runs/${parentRunId}/approve (no-order)`, err)
          throw err
        })

      expect(approveRes.status).toBe(200)
      const children = approveRes.data.result?.children || []
      expect(children.length).toBe(2)

      // 3) Verify both have null depends_on_run_ids
      for (const child of children) {
        expect(child.depends_on_run_ids).toBeNull()
      }

      // 4) Both should be dispatchable (start-dispatch should succeed)
      for (const child of children) {
        const startRes = await api
          .post(
            `/admin/production-runs/${child.id}/start-dispatch`,
            {},
            adminHeaders
          )
          .catch((err: any) => {
            logAxiosErr(`POST /admin/production-runs/${child.id}/start-dispatch (no-order)`, err)
            throw err
          })

        expect(startRes.status).toBe(202)
      }
    })
  })
})
