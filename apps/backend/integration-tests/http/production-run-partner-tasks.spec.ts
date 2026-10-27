import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(240000)

/**
 * A partner task done FOR a production run by another partner — a
 * photographer's shoot for a weaver's run.
 *
 * What must hold: the task shows on the run and the run shows on the task, but
 * the task is never one of the run's own steps. Cancelling the run must leave
 * the shoot alone (the run's own tasks are cancelled with it), and the run's
 * maker is not revealed to the photographer.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/production-run-partner-tasks
 */
setupSharedTestSuite(() => {
  describe("partner tasks for a production run", () => {
    const { api, getContainer } = getSharedTestEnv()

    const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (e: any) {
        console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
        throw e
      }
    }

    async function createPartner(unique: number, tag: string) {
      const email = `rpt-${tag}-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      const res = await api.post(
        "/partners",
        {
          name: `RPT Partner ${tag} ${unique}`,
          handle: `rpt-partner-${tag}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        partnerHeaders: { headers: { Authorization: `Bearer ${login.data.token}` } },
      }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const maker = await createPartner(unique, "maker")
      const photographer = await createPartner(unique, "photo")

      const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const run = await service.createProductionRuns({
        status: "in_progress",
        quantity: 4,
        partner_id: maker.partnerId,
        snapshot: {},
        captured_at: new Date(),
      })
      return { adminHeaders, maker, photographer, runId: run.id as string }
    }

    it("links a shoot to another partner's run without making it a run step", async () => {
      const { adminHeaders, maker, photographer, runId } = await setup()

      const created = await loud("create", () =>
        api.post(
          `/admin/partners/${photographer.partnerId}/tasks`,
          {
            title: "Model photo shoot",
            estimated_cost: 3000,
            cost_currency: "inr",
            production_run_id: runId,
          },
          adminHeaders
        )
      )
      const task = created.data.task
      const taskId: string = Array.isArray(task) ? task[0].id : task.id ?? task.parent?.id
      expect(taskId).toBeTruthy()

      // The run lists it, with the photographer as its partner.
      const onRun = await loud("run partner-tasks", () =>
        api.get(`/admin/production-runs/${runId}/partner-tasks`, adminHeaders)
      )
      expect(onRun.data.partner_tasks.map((t: any) => t.id)).toEqual([taskId])
      expect(onRun.data.partner_tasks[0].partner.id).toBe(photographer.partnerId)

      // ...but it is not one of the run's own tasks.
      const runDetail = await api.get(`/admin/production-runs/${runId}`, adminHeaders)
      const ownTasks = runDetail.data.tasks ?? runDetail.data.production_run?.tasks ?? []
      expect(ownTasks.map((t: any) => t.id)).not.toContain(taskId)

      // Admin task reads carry the run.
      const list = await api.get(`/admin/partners/${photographer.partnerId}/tasks`, adminHeaders)
      const listed = list.data.tasks.find((t: any) => t.id === taskId)
      expect(listed.production_run.id).toBe(runId)
      expect(listed.production_run.partner_id).toBe(maker.partnerId)

      // The photographer sees which run, not who makes it.
      const mine = await loud("partner list", () =>
        api.get(`/partners/assigned-tasks`, photographer.partnerHeaders)
      )
      const seen = mine.data.tasks.find((t: any) => t.id === taskId)
      expect(seen.production_run.id).toBe(runId)
      expect(seen.production_run).not.toHaveProperty("partner_id")
      const one = await loud("partner detail", () =>
        api.get(`/partners/assigned-tasks/${taskId}`, photographer.partnerHeaders)
      )
      expect(one.data.task.production_run.id).toBe(runId)
      expect(one.data.task.production_run).not.toHaveProperty("partner_id")

      // The run's maker does not get the shoot in their task list.
      const makers = await api.get(`/partners/assigned-tasks`, maker.partnerHeaders)
      expect(makers.data.tasks.map((t: any) => t.id)).not.toContain(taskId)

      // Cancelling the run leaves the shoot alone.
      await loud("cancel run", () =>
        api.post(`/admin/production-runs/${runId}/cancel`, { reason: "test" }, adminHeaders)
      )
      const after = await api.get(
        `/admin/partners/${photographer.partnerId}/tasks/${taskId}`,
        adminHeaders
      )
      expect(after.data.task.status).not.toBe("cancelled")
      expect(after.data.task.status).not.toBe("completed")
    })

    it("refuses an unknown run without creating a task, and attaches or detaches on update", async () => {
      const { adminHeaders, photographer, runId } = await setup()
      const base = `/admin/partners/${photographer.partnerId}/tasks`

      const bad = await api
        .post(base, { title: "Shoot", production_run_id: "prod_run_missing" }, adminHeaders)
        .catch((e) => e.response)
      expect(bad.status).toBe(404)
      const none = await api.get(base, adminHeaders)
      expect(none.data.tasks).toHaveLength(0)

      // An independent task: no run.
      const created = await loud("create plain", () =>
        api.post(base, { title: "Lookbook edit" }, adminHeaders)
      )
      const task = created.data.task
      const taskId: string = Array.isArray(task) ? task[0].id : task.id ?? task.parent?.id
      const plain = await api.get(`${base}/${taskId}`, adminHeaders)
      expect(plain.data.task.production_run).toBeNull()

      // Attach it later.
      const attached = await loud("attach", () =>
        api.patch(`${base}/${taskId}`, { production_run_id: runId }, adminHeaders)
      )
      expect(attached.data.task.production_run.id).toBe(runId)

      // Detach it.
      const detached = await loud("detach", () =>
        api.patch(`${base}/${taskId}`, { production_run_id: null }, adminHeaders)
      )
      expect(detached.data.task.production_run).toBeNull()
      const onRun = await api.get(`/admin/production-runs/${runId}/partner-tasks`, adminHeaders)
      expect(onRun.data.partner_tasks).toHaveLength(0)
    })

    it("an admin marking a task completed stamps completed_at, once", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const photographer = await createPartner(Date.now(), "done")
      const base = `/admin/partners/${photographer.partnerId}/tasks`

      const created = await loud("create", () =>
        api.post(base, { title: "Photo Shoot", estimated_cost: 500, cost_currency: "inr" }, adminHeaders)
      )
      const task = created.data.task
      const taskId: string = Array.isArray(task) ? task[0].id : task.id ?? task.parent?.id
      expect(created.data.task.completed_at ?? null).toBeNull()

      const done = await loud("complete", () =>
        api.patch(`${base}/${taskId}`, { status: "completed", actual_cost: 500 }, adminHeaders)
      )
      expect(done.data.task.status).toBe("completed")
      const stampedAt = done.data.task.completed_at
      expect(stampedAt).toBeTruthy()

      // A later save must keep the original date, not move it.
      const resaved = await loud("resave", () =>
        api.patch(`${base}/${taskId}`, { status: "completed", description: "edited" }, adminHeaders)
      )
      expect(resaved.data.task.completed_at).toBe(stampedAt)

      // A task completed before the stamp existed (completed, no date) is
      // backfilled by re-saving it as completed.
      await container.resolve("tasks").updateTasks({ id: taskId, completed_at: null })
      const backfilled = await loud("backfill", () =>
        api.patch(`${base}/${taskId}`, { status: "completed" }, adminHeaders)
      )
      expect(backfilled.data.task.completed_at).toBeTruthy()
    })
  })
})
