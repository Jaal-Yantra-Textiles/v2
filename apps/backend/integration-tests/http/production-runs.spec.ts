import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("Production Runs", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let partnerHeaders: { headers: Record<string, string> }
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

      // Create email templates used by workflows (ignore if already exists)
      const emailTemplates = [
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
        {
          name: "Design Production Started",
          template_key: "design-production-started",
          subject: "Production started for {{design_name}}",
          html_content: "<div>Production for {{design_name}} has started.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
        {
          name: "Design Production Completed",
          template_key: "design-production-completed",
          subject: "Production completed for {{design_name}}",
          html_content: "<div>Production for {{design_name}} is complete.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
      ]
      for (const tpl of emailTemplates) {
        try {
          await api.post("/admin/email-templates", tpl, adminHeaders)
        } catch (e: any) {
          // ok
        }
      }

      const unique = Date.now()
      const partnerEmail = `prod-partner-admin-${unique}@jyt.test`
      const partnerPassword = "supersecret"

      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: partnerPassword,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: partnerPassword,
      })

      const createPartnerRes: any = await api.post(
        "/partners",
        {
          name: `Prod Partner ${unique}`,
          handle: `prod-partner-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Prod",
            last_name: "Partner",
          },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )

      expect(createPartnerRes.status).toBe(200)
      partnerId = createPartnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: partnerPassword,
      })

      partnerHeaders = { headers: { Authorization: `Bearer ${login2.data.token}` } }

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

      // 5) Partner accepts the production run
      const acceptRes = await api
        .post(`/partners/production-runs/${childRunId}/accept`, {}, partnerHeaders)
        .catch((err: any) => {
          logAxiosErr(`POST /partners/production-runs/${childRunId}/accept`, err)
          throw err
        })

      expect(acceptRes.status).toBe(200)

      // 6) Verify child run status updated to in_progress
      const acceptedChild = await api
        .get(`/admin/production-runs/${childRunId}`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/production-runs/${childRunId} after accept`, err)
          throw err
        })

      expect(String(acceptedChild.data.production_run.status)).toBe("in_progress")

      // 7) Verify parent run status bumped to in_progress
      const acceptedParent = await api
        .get(`/admin/production-runs/${parentRunId}`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/production-runs/${parentRunId} after accept`, err)
          throw err
        })

      expect(String(acceptedParent.data.production_run.status)).toBe("in_progress")

      // 8) Partner completes template tasks
      const afterAcceptRun = await api
        .get(`/admin/production-runs/${childRunId}`, adminHeaders)
        .catch((err: any) => {
          logAxiosErr(`GET /admin/production-runs/${childRunId} to finish tasks`, err)
          throw err
        })

      const tasksForRun = afterAcceptRun.data.tasks || []
      const templateTasks = tasksForRun.filter(
        (t: any) => t?.title === templateA.name || t?.title === templateB.name
      )
      expect(templateTasks.length).toBe(2)

      for (const t of templateTasks) {
        const finishRes = await api
          .post(`/partners/assigned-tasks/${t.id}/finish`, {}, partnerHeaders)
          .catch((err: any) => {
            logAxiosErr(`POST /partners/assigned-tasks/${t.id}/finish`, err)
            throw err
          })
        expect(finishRes.status).toBe(200)
      }

      // 9) Wait until the run and parent run are auto-marked completed
      await waitFor(
        async () => {
          const runRes = await api.get(`/admin/production-runs/${childRunId}`, adminHeaders)
          const parentRes = await api.get(
            `/admin/production-runs/${parentRunId}`,
            adminHeaders
          )
          return (
            String(runRes.data?.production_run?.status) === "completed" &&
            String(parentRes.data?.production_run?.status) === "completed"
          )
        },
        { timeoutMs: 10_000, intervalMs: 500 }
      )

      // 10) Verify tasks linked to design
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

      // 11) Verify tasks linked to partner
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

      // 12) Verify tasks linked to production run (via admin retrieve)
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

    /**
     * #1265 — a dispatched run must record WHICH templates it went out with.
     *
     * `dispatch_template_names` looks like it answers this and does not: it is
     * approval-time intent, written only when an approver named templates, so a
     * run whose templates are chosen at dispatch keeps it null forever. This
     * asserts the field that dispatch itself writes, over the real HTTP path,
     * and dispatches BY ID — a name is not an identity (#1261).
     */
    it("records dispatched_template_ids on the run when dispatched by id", async () => {
      const { api } = getSharedTestEnv()

      const unique = `${Date.now()}-rec`
      const mkTemplate = (step: string) => ({
        name: `prod-record-${step}-${unique}`,
        description: `Record step ${step}`,
        priority: "medium",
        estimated_duration: 30,
        eventable: false,
        notifiable: false,
        metadata: { workflow_type: "production_run", step },
        category: "Production",
      })

      const templateA = mkTemplate("a")
      const t1 = await api.post("/admin/task-templates", templateA, adminHeaders)
      expect(t1.status).toBe(201)
      const templateAId = t1.data.task_template.id
      const categoryId = t1.data.task_template.category_id

      const { category: _c, ...templateB } = {
        ...mkTemplate("b"),
        category_id: categoryId,
      } as any
      const t2 = await api.post("/admin/task-templates", templateB, adminHeaders)
      expect(t2.status).toBe(201)
      const templateBId = t2.data.task_template.id

      const createRunRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 4 },
        adminHeaders
      )
      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      // Nothing is named at approval — exactly the case that leaves
      // `dispatch_template_names` null forever.
      const approveRes = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            { partner_id: partnerId, role: "production", quantity: 4 },
          ],
        },
        adminHeaders
      )
      expect(approveRes.status).toBe(200)
      const childRunId = (approveRes.data.result?.children || [])[0]?.id
      expect(childRunId).toBeTruthy()

      const startRes = await api.post(
        `/admin/production-runs/${childRunId}/start-dispatch`,
        {},
        adminHeaders
      )
      expect(startRes.status).toBe(202)

      const resumeRes = await api.post(
        `/admin/production-runs/${childRunId}/resume-dispatch`,
        {
          transaction_id: startRes.data.transaction_id,
          template_ids: [templateAId, templateBId],
        },
        adminHeaders
      )
      expect(resumeRes.status).toBe(200)

      const deadline = Date.now() + 15_000
      let run: any = null
      while (Date.now() < deadline) {
        const res = await api.get(
          `/admin/production-runs/${childRunId}`,
          adminHeaders
        )
        run = res.data.production_run
        if (
          String(run?.status) === "sent_to_partner" &&
          (run?.dispatched_template_ids || []).length
        ) {
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }

      expect(String(run?.status)).toBe("sent_to_partner")
      // Caller order is the order the partner works in — preserved, not sorted.
      expect(run?.dispatched_template_ids).toEqual([templateAId, templateBId])
      // The intent field stays null: it is not, and never was, this record.
      expect(run?.dispatch_template_names ?? null).toBeNull()
    })

    /**
     * #1268 — approval and auto-dispatch are two workflows in one request with
     * no transaction across them, and approval commits first.
     *
     * An approval carrying template IDS dispatches straight through. An
     * approval whose dispatch fails must still BE an approval: the old code let
     * the throw escape, so the admin was told approval failed when it had
     * committed, the run sat approved with no tasks, and `assertCanApprove`
     * then refused a retry because it was no longer pending_review.
     */
    it("approves with template ids and auto-dispatches the children", async () => {
      const { api } = getSharedTestEnv()

      const unique = `${Date.now()}-appr`
      const t1 = await api.post(
        "/admin/task-templates",
        {
          name: `prod-approve-a-${unique}`,
          description: "Approve step A",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run", step: "a" },
          category: "Production",
        },
        adminHeaders
      )
      expect(t1.status).toBe(201)
      const templateId = t1.data.task_template.id
      const templateName = t1.data.task_template.name

      const createRunRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 2 },
        adminHeaders
      )
      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      const approveRes = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            {
              partner_id: partnerId,
              role: "production",
              quantity: 2,
              template_ids: [templateId],
            },
          ],
        },
        adminHeaders
      )

      expect(approveRes.status).toBe(200)
      const childRunId = (approveRes.data.result?.children || [])[0]?.id
      expect(childRunId).toBeTruthy()

      // The approval carried the ids through, and the route reports what went out.
      expect(approveRes.data.dispatch?.dispatched).toEqual([childRunId])
      expect(approveRes.data.dispatch?.failed).toEqual([])

      const runRes = await api.get(
        `/admin/production-runs/${childRunId}`,
        adminHeaders
      )
      expect(String(runRes.data.production_run.status)).toBe("sent_to_partner")
      expect(runRes.data.production_run.dispatch_template_ids).toEqual([templateId])
      // And what it was dispatched with was recorded (#1265).
      expect(runRes.data.production_run.dispatched_template_ids).toEqual([templateId])
      const titles = (runRes.data.tasks || []).map((t: any) => t.title)
      expect(titles).toContain(templateName)
    })

    it("keeps the approval when the auto-dispatch fails, and says which run failed", async () => {
      const { api } = getSharedTestEnv()

      const createRunRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 2 },
        adminHeaders
      )
      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      // A template id that does not exist — dispatch refuses it outright, which
      // is precisely the class of failure that used to 500 the approval.
      const approveRes = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            {
              partner_id: partnerId,
              role: "production",
              quantity: 2,
              template_ids: ["tpl_does_not_exist_01K"],
            },
          ],
        },
        adminHeaders
      )

      // The approval succeeded, and says so.
      expect(approveRes.status).toBe(200)
      const childRunId = (approveRes.data.result?.children || [])[0]?.id
      expect(childRunId).toBeTruthy()

      expect(approveRes.data.dispatch?.dispatched).toEqual([])
      expect(approveRes.data.dispatch?.failed).toHaveLength(1)
      expect(approveRes.data.dispatch?.failed[0].production_run_id).toBe(childRunId)
      expect(String(approveRes.data.dispatch?.failed[0].message)).toContain(
        "tpl_does_not_exist_01K"
      )

      // The run is approved and undispatched — recoverable through the normal
      // dispatch drawer, rather than a run nobody can act on.
      const parentRes = await api.get(
        `/admin/production-runs/${parentRunId}`,
        adminHeaders
      )
      expect(String(parentRes.data.production_run.status)).toBe("approved")

      const childRes = await api.get(
        `/admin/production-runs/${childRunId}`,
        adminHeaders
      )
      expect(String(childRes.data.production_run.status)).toBe("approved")
      expect(
        childRes.data.production_run.dispatched_template_ids ?? null
      ).toBeNull()
    })

    /**
     * #1676 — a run may state NO agreed quantity.
     *
     * `quantity` was `not null default 1`, so "there is no agreed amount" was
     * unrepresentable: an unset quantity read as a run ordered for ONE piece,
     * which is the tightest possible payment ceiling rather than the absence of
     * one. Since every payment claim — including a run's first — is bounded by
     * that quantity, this null is the explicit, per-run opt-out.
     */
    describe("a run with no agreed quantity (#1676)", () => {
      it("creates one, and keeps the null rather than defaulting it to 1", async () => {
        const { api } = getSharedTestEnv()

        const res = await api.post(
          "/admin/production-runs",
          { design_id: designId, quantity: null },
          adminHeaders
        )

        expect(res.status).toBe(201)
        expect(res.data.production_run.quantity).toBeNull()

        // And it reads back that way — the column is nullable, not just the
        // response shape.
        const detail = await api.get(
          `/admin/production-runs/${res.data.production_run.id}`,
          adminHeaders
        )
        expect(detail.data.production_run.quantity).toBeNull()
      })

      it("still defaults to 1 when the field is simply omitted", async () => {
        // Omitting is not declaring. Only an explicit null opts out.
        const { api } = getSharedTestEnv()

        const res = await api.post(
          "/admin/production-runs",
          { design_id: designId },
          adminHeaders
        )

        expect(res.status).toBe(201)
        expect(res.data.production_run.quantity).toBe(1)
      })

      it("passes open-endedness down to the child runs on approve", async () => {
        // 🔴 `a.quantity ?? parent.quantity ?? 1` collapsed an open-ended
        // parent to 1 — the tightest ceiling on a run whose whole point is that
        // it has none, and only visible when a partner's claim was refused.
        const { api } = getSharedTestEnv()

        const parent = await api.post(
          "/admin/production-runs",
          { design_id: designId, quantity: null },
          adminHeaders
        )
        expect(parent.status).toBe(201)

        const approved = await api.post(
          `/admin/production-runs/${parent.data.production_run.id}/approve`,
          { assignments: [{ partner_id: partnerId, role: "production" }] },
          adminHeaders
        )
        expect(approved.status).toBe(200)

        const child = (approved.data.result?.children || [])[0]
        expect(child).toBeTruthy()
        expect(child.quantity).toBeNull()
      })

      it("clears an agreed quantity on a run that has not been accepted", async () => {
        const { api } = getSharedTestEnv()

        const created = await api.post(
          "/admin/production-runs",
          { design_id: designId, quantity: 5 },
          adminHeaders
        )
        expect(created.data.production_run.quantity).toBe(5)

        const updated = await api.post(
          `/admin/production-runs/${created.data.production_run.id}`,
          { quantity: null },
          adminHeaders
        )

        expect(updated.status).toBe(200)
        expect(updated.data.production_run.quantity).toBeNull()
      })

      it("refuses a quantity of 0 — a broken number is not a declaration", async () => {
        // `Number(null)` is 0, so the two used to be written the same way. A
        // zero quantity IS set and is unusable, and every payment guard refuses
        // on it; only null means open-ended.
        const { api } = getSharedTestEnv()

        const created = await api.post(
          "/admin/production-runs",
          { design_id: designId, quantity: 5 },
          adminHeaders
        )

        const res = await api
          .post(
            `/admin/production-runs/${created.data.production_run.id}`,
            { quantity: 0 },
            adminHeaders
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toContain("positive number")
      })
    })
  })
})
