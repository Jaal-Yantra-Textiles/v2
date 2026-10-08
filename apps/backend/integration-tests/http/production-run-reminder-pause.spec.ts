import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { emitProductionRunReminderWorkflow } from "../../src/workflows/production-runs/emit-production-run-reminder"

jest.setTimeout(90000)

/**
 * Pausing the daily partner reminders on ONE run. A run sent before its stage
 * order was reversed (Chupa embroidery, 2026-10-08) was about to be re-sent to
 * its partner at the reminder cap — telling them to start work that must wait.
 */
setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  const createSentRun = async () => {
    const runs = getContainer().resolve("production_runs") as any
    return runs.createProductionRuns({
      design_id: "design_reminder_pause",
      partner_id: "partner_reminder_pause",
      status: "sent_to_partner",
      quantity: 3,
      role: "embroidery",
      metadata: { source: "spec" },
      snapshot: {},
      captured_at: new Date(),
    })
  }

  const remind = async (runId: string) => {
    const { result } = await emitProductionRunReminderWorkflow(getContainer()).run({
      input: {
        production_run_id: runId,
        partner_id: "partner_reminder_pause",
        reminder_kind: "assignment_pending",
      },
    })
    return result as any
  }

  it("a paused run is skipped by the reminder workflow, and reminded again once resumed", async () => {
    const run = await createSentRun()

    const paused = await api.post(
      `/admin/production-runs/${run.id}/reminders`,
      { paused: true, reason: "waits for Sharlho's stitching" },
      headers
    )
    expect(paused.status).toBe(200)
    expect(paused.data.reminders_paused).toMatchObject({ reason: "waits for Sharlho's stitching" })

    const skipped = await remind(run.id)
    expect(skipped).toMatchObject({ action: "skipped", reason: "reminders_paused" })

    const runs = getContainer().resolve("production_runs") as any
    const afterSkip = await runs.retrieveProductionRun(run.id)
    expect(afterSkip.reminder_count ?? 0).toBe(0)
    // Other metadata survives the pause.
    expect(afterSkip.metadata.source).toBe("spec")

    const resumed = await api.post(`/admin/production-runs/${run.id}/reminders`, { paused: false }, headers)
    expect(resumed.data.reminders_paused).toBeNull()

    const reminded = await remind(run.id)
    expect(reminded.action).toBe("reminded")
  })

  it("records pause and resume on the run's timeline, once each", async () => {
    const run = await createSentRun()
    await api.post(`/admin/production-runs/${run.id}/reminders`, { paused: true, reason: "hold" }, headers)
    // Pausing an already-paused run changes nothing and logs nothing.
    await api.post(`/admin/production-runs/${run.id}/reminders`, { paused: true }, headers)
    await api.post(`/admin/production-runs/${run.id}/reminders`, { paused: false }, headers)

    const res = await api.get(`/admin/production-runs/${run.id}/activities?activity_type=note`, headers)
    const kinds = res.data.activities.map((a: any) => a.kind).sort()
    expect(kinds).toEqual(["reminders_paused", "reminders_resumed"])
  })

  it("refuses a body without paused, and 404s an unknown run", async () => {
    const run = await createSentRun()
    const bad = await api
      .post(`/admin/production-runs/${run.id}/reminders`, { reason: "x" }, headers)
      .catch((e) => e.response)
    expect(bad.status).toBe(400)
    const missing = await api
      .post(`/admin/production-runs/prod_run_missing/reminders`, { paused: true }, headers)
      .catch((e) => e.response)
    expect(missing.status).toBe(404)
  })
})
