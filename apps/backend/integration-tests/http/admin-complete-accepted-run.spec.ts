import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { runProductionRunLifecycleWorkflow } from "../../src/workflows/production-runs/run-production-run-lifecycle"

jest.setTimeout(120 * 1000)

/**
 * Admin complete on a run the partner ACCEPTED but never started.
 *
 * The run's lifecycle workflow awaits start → finish → complete in order. The
 * admin override stamped started_at/finished_at on the run but never signalled
 * those awaits, so completing signalled `await-run-complete` while the
 * transaction still sat at `await-run-start`: "Cannot set step success when
 * status is idle" (Embroprint, 2026-10-04). The workaround was to start and
 * finish the run by hand first.
 */
setupSharedTestSuite(() => {
  describe("POST /admin/production-runs/:id/complete on an accepted run", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createPartner(unique: number) {
      const email = `admin-complete-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      const res = await api.post(
        "/partners",
        {
          name: `Admin Complete ${unique}`,
          handle: `admin-complete-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      expect(res.status).toBe(200)
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
    })

    it("completes it and walks the lifecycle through start and finish", async () => {
      const unique = Date.now()
      const { partnerId, partnerHeaders } = await createPartner(unique)

      const design = await api.post(
        "/admin/designs",
        {
          name: `Admin Complete Design ${unique}`,
          description: "x",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(design.status).toBe(201)

      const created = await api.post(
        "/admin/production-runs",
        { design_id: design.data.design.id, partner_id: partnerId, quantity: 1 },
        adminHeaders
      )
      expect(created.status).toBe(201)
      const runId = created.data.production_run.id

      const container = getContainer()
      const runService: any = container.resolve("production_runs")
      await runService.updateProductionRuns({ id: runId, status: "sent_to_partner" })

      // A LIVE lifecycle, parked at await-run-start — what dispatch leaves.
      await runProductionRunLifecycleWorkflow(container).run({
        input: { production_run_id: runId },
      })
      const parked = await runService.retrieveProductionRun(runId)
      expect(parked.lifecycle_transaction_id).toEqual(expect.any(String))

      const accept = await api.post(
        `/partners/production-runs/${runId}/accept`,
        {},
        { headers: partnerHeaders, validateStatus: () => true }
      )
      expect(accept.status).toBe(200)

      // Accepted, never started — admin completes on the partner's behalf.
      const complete = await api.post(
        `/admin/production-runs/${runId}/complete`,
        { produced_quantity: 1 },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(complete.status).toBe(200)

      const done = await runService.retrieveProductionRun(runId)
      expect(done.status).toBe("completed")
      expect(done.started_at).toBeTruthy()
      expect(done.finished_at).toBeTruthy()
    })
  })
})
