import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("Production Runs", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let designId: string

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

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // Create the email template used by partner creation workflows (ignore if exists)
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
      } catch (e: any) {
        // ok
      }

      const unique = Date.now()
      const partnerRes = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `Prod Partner ${unique}`,
            handle: `prod-partner-${unique}`,
          },
          admin: {
            email: `prod-partner-admin-${unique}@jyt.test`,
            first_name: "Prod",
            last_name: "Partner",
          },
        },
        adminHeaders
      )

      expect(partnerRes.status).toBe(201)
      partnerId = partnerRes.data.partner.id

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Production Design ${unique}`,
          description: "Design for production run test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          metadata: {
            moodboard: { source: "test" },
          },
        },
        adminHeaders
      )

      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id
    })

    it("should create → approve (child run) → send to production and link tasks", async () => {
      const { api } = getSharedTestEnv()

      const unique = Date.now()
      const templateA = {
        name: `prod-step-a-${unique}`,
        description: "Production step A",
        priority: "medium",
        estimated_duration: 30,
        eventable: false,
        notifiable: false,
        metadata: {
          workflow_type: "production_run",
          step: "a",
        },
        category: "Production",
      }
      const templateB = {
        name: `prod-step-b-${unique}`,
        description: "Production step B",
        priority: "medium",
        estimated_duration: 30,
        eventable: false,
        notifiable: false,
        metadata: {
          workflow_type: "production_run",
          step: "b",
        },
        category: "Production",
      }

      const t1 = await api.post("/admin/task-templates", templateA, adminHeaders)
      expect(t1.status).toBe(201)
      const categoryId = t1.data.task_template.category_id

      const { category: _c, ...templateBClean } = {
        ...templateB,
        category_id: categoryId,
      } as any

      const t2 = await api.post("/admin/task-templates", templateBClean, adminHeaders)
      expect(t2.status).toBe(201)

      // 1) Create parent production run (no partner yet)
      const createRunRes = await api
        .post(
          "/admin/production-runs",
          {
            design_id: designId,
            quantity: 10,
          },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr("POST /admin/production-runs", err)
          throw err
        })

      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id
      expect(createRunRes.data.production_run.design_id).toBe(designId)
      expect(createRunRes.data.production_run.status).toBe("pending_review")

      // 2) Approve and create child run for partner
      const approveRes = await api
        .post(
          `/admin/production-runs/${parentRunId}/approve`,
          {
            assignments: [
              {
                partner_id: partnerId,
                role: "production",
                quantity: 10,
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
      expect(children.length).toBe(1)
      const childRunId = children[0].id
      expect(children[0].parent_run_id).toBe(parentRunId)
      expect(children[0].partner_id).toBe(partnerId)

      // 3) Start dispatch (long-running workflow)
      const startDispatchRes = await api
        .post(
          `/admin/production-runs/${childRunId}/start-dispatch`,
          {},
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(
            `POST /admin/production-runs/${childRunId}/start-dispatch`,
            err
          )
          throw err
        })

      expect(startDispatchRes.status).toBe(202)
      const dispatchTransactionId = startDispatchRes.data.transaction_id
      expect(dispatchTransactionId).toBeTruthy()

      // 4) Resume dispatch with selected templates
      const resumeDispatchRes = await api
        .post(
          `/admin/production-runs/${childRunId}/resume-dispatch`,
          {
            transaction_id: dispatchTransactionId,
            template_names: [templateA.name, templateB.name],
          },
          adminHeaders
        )
        .catch((err: any) => {
          logAxiosErr(
            `POST /admin/production-runs/${childRunId}/resume-dispatch`,
            err
          )
          throw err
        })

      expect(resumeDispatchRes.status).toBe(200)

      const waitFor = async (
        fn: () => Promise<boolean>,
        {
          timeoutMs,
          intervalMs,
        }: { timeoutMs: number; intervalMs: number }
      ) => {
        const started = Date.now()
        while (Date.now() - started < timeoutMs) {
          const ok = await fn()
          if (ok) return
          await new Promise((r) => setTimeout(r, intervalMs))
        }
        throw new Error(`Timed out after ${timeoutMs}ms`)
      }

      // Wait until workflow has created/linked tasks (resume endpoint returns immediately)
      await waitFor(
        async () => {
          const runRes = await api.get(`/admin/production-runs/${childRunId}`, adminHeaders)
          const run = runRes.data.production_run
          const tasks = runRes.data.tasks || []
          const titles = tasks.map((t: any) => t.title)
          return (
            String(run?.status) === "sent_to_partner" &&
            titles.includes(`production-run-${childRunId}`) &&
            titles.includes(templateA.name) &&
            titles.includes(templateB.name)
          )
        },
        { timeoutMs: 10_000, intervalMs: 500 }
      )

      // 5) Verify tasks linked to design
      const designTasksRes = await api
        .get(`/admin/designs/${designId}/tasks`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/designs/${designId}/tasks`, err)
          throw err
        })
      expect(designTasksRes.status).toBe(200)
      const tasks = designTasksRes.data?.tasks || designTasksRes.data?.taskLinks?.list || []
      const titles = (tasks || []).map((t: any) => t.title)

      expect(titles).toContain(`production-run-${childRunId}`)
      expect(titles).toContain(templateA.name)
      expect(titles).toContain(templateB.name)

      // 6) Verify tasks linked to partner
      const partnerTasksRes = await api
        .get(`/admin/partners/${partnerId}/tasks`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/partners/${partnerId}/tasks`, err)
          throw err
        })
      expect(partnerTasksRes.status).toBe(200)
      const partnerTasks = partnerTasksRes.data?.tasks || []
      const partnerTitles = partnerTasks.map((t: any) => t.title)
      expect(partnerTitles).toContain(`production-run-${childRunId}`)
      expect(partnerTitles).toContain(templateA.name)
      expect(partnerTitles).toContain(templateB.name)

      // 7) Verify tasks linked to production run (via admin retrieve)
      const runRes = await api
        .get(`/admin/production-runs/${childRunId}`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/production-runs/${childRunId}`, err)
          throw err
        })
      expect(runRes.status).toBe(200)
      expect(runRes.data.production_run.id).toBe(childRunId)
      const runTasks = runRes.data.tasks || []
      const runTaskTitles = runTasks.map((t: any) => t.title)
      expect(runTaskTitles).toContain(`production-run-${childRunId}`)
      expect(runTaskTitles).toContain(templateA.name)
      expect(runTaskTitles).toContain(templateB.name)
    })
  })
})
