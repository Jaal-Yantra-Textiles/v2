import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"

jest.setTimeout(90 * 1000)

/**
 * #1228 — manual (re)assignment out of `awaiting_reassignment`.
 *
 * #1093 shipped the automatic half (reminder cap / decline → unassign + park)
 * but nothing that moved a parked run back out: no route set `partner_id` on an
 * existing run, and the policy excluded `awaiting_reassignment` from every
 * dispatch transition. A parked run was a dead end, even for a retry with the
 * SAME partner.
 *
 * These cases cover the whole recovery loop end to end: park it, send it back
 * to the same partner, hand it to a different one, and the guards that stop an
 * operator putting a run somewhere the API cannot honour.
 */
setupSharedTestSuite(() => {
  describe("Admin manual production-run partner assignment", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createPartner(slug: string, unique: number) {
      const email = `${slug}-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      const headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `Partner ${slug} ${unique}`,
          handle: `${slug}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      // Re-login: the token gains the partner actor after creation.
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        headers: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    /** A design + an approved child run assigned to `partnerId`. */
    async function createAssignedRun(designId: string, partnerId: string) {
      const parent = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 4 },
        adminHeaders
      )
      expect(parent.status).toBe(201)

      const approve = await api.post(
        `/admin/production-runs/${parent.data.production_run.id}/approve`,
        { assignments: [{ partner_id: partnerId, role: "stitching", quantity: 4 }] },
        adminHeaders
      )
      expect(approve.status).toBe(200)

      const child = (approve.data.result?.children || []).find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === partnerId
      )
      expect(child?.id).toBeTruthy()
      return child.id as string
    }

    async function getRun(runId: string) {
      const res = await api.get(`/admin/production-runs/${runId}`, adminHeaders)
      expect(res.status).toBe(200)
      return res.data.production_run
    }

    async function createDesign(unique: number, label: string) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Manual Assign ${label} ${unique}`,
          description: "Design used by the #1228 manual assignment spec",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("re-assigns a parked run to the SAME partner and makes it dispatchable again", async () => {
      const unique = Date.now()
      const a = await createPartner("assign-same", unique)
      const designId = await createDesign(unique, "Same")
      const runId = await createAssignedRun(designId, a.partnerId)

      // Park it the way production does: the partner declines.
      const declined = await api.post(
        `/partners/production-runs/${runId}/decline`,
        { reason: "capacity", notes: "Machine down" },
        { headers: a.headers, validateStatus: () => true }
      )
      expect(declined.status).toBe(200)
      expect(declined.data.production_run.status).toBe("awaiting_reassignment")
      expect(declined.data.production_run.partner_id).toBeFalsy()
      expect(declined.data.production_run.previous_partner_id).toBe(a.partnerId)

      // The #1228 route: send it straight back to the same partner.
      const assigned = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        { partner_id: a.partnerId, note: "Called them, they'll take it" },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(assigned.status).toBe(200)
      expect(assigned.data.same_partner).toBe(true)
      expect(assigned.data.previous_partner_id).toBe(a.partnerId)

      const run = await getRun(runId)
      expect(run.status).toBe("approved")
      expect(run.partner_id).toBe(a.partnerId)
      // The park reason described the previous failure — it must not linger as
      // a live warning against the partner now holding the run.
      expect(run.cancelled_reason).toBeFalsy()
      // The reminder cycle and the retry budget both restart.
      expect(run.reminder_count ?? 0).toBe(0)
      expect(run.reminder_status ?? null).toBeFalsy()
      expect(run.reassign_retry_count ?? 0).toBe(0)
      // The dispatch cycle must be rewound, or the admin Dispatch action stays
      // hidden (it requires dispatch_state "idle" AND no dispatch_completed_at)
      // and the run would be assigned but unsendable.
      expect(run.dispatch_state).toBe("idle")
      expect(run.dispatch_completed_at).toBeFalsy()
      expect(run.accepted_at).toBeFalsy()
    })

    it("hands a parked run to a DIFFERENT partner and records who dropped it", async () => {
      const unique = Date.now() + 1
      const a = await createPartner("assign-from", unique)
      const b = await createPartner("assign-to", unique)
      const designId = await createDesign(unique, "Different")
      const runId = await createAssignedRun(designId, a.partnerId)

      const declined = await api.post(
        `/partners/production-runs/${runId}/decline`,
        { reason: "capacity" },
        { headers: a.headers, validateStatus: () => true }
      )
      expect(declined.status).toBe(200)

      const assigned = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        { partner_id: b.partnerId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(assigned.status).toBe(200)
      expect(assigned.data.same_partner).toBe(false)
      expect(assigned.data.previous_partner_id).toBe(a.partnerId)

      const run = await getRun(runId)
      expect(run.status).toBe("approved")
      expect(run.partner_id).toBe(b.partnerId)
      // Audit trail: partner A is still legible as the one who let it go.
      expect(run.previous_partner_id).toBe(a.partnerId)

      // And it really is dispatchable — not just cosmetically "approved".
      const dispatch = await api.post(
        `/admin/production-runs/${runId}/start-dispatch`,
        {},
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(dispatch.status).toBe(202)
      expect(dispatch.data.transaction_id).toBeTruthy()
    })

    it("rejects an unknown partner without touching the run", async () => {
      const unique = Date.now() + 2
      const a = await createPartner("assign-bogus", unique)
      const designId = await createDesign(unique, "Bogus")
      const runId = await createAssignedRun(designId, a.partnerId)

      await api.post(
        `/partners/production-runs/${runId}/decline`,
        { reason: "capacity" },
        { headers: a.headers, validateStatus: () => true }
      )

      const res = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        { partner_id: "part_does_not_exist" },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(404)

      // The run must be untouched — a typo'd id assigning the run to nobody
      // would be worse than the dead end #1228 set out to fix.
      const run = await getRun(runId)
      expect(run.status).toBe("awaiting_reassignment")
      expect(run.partner_id).toBeFalsy()
    })

    it("requires partner_id", async () => {
      const unique = Date.now() + 3
      const a = await createPartner("assign-novalid", unique)
      const designId = await createDesign(unique, "NoValid")
      const runId = await createAssignedRun(designId, a.partnerId)

      const res = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        {},
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(400)
    })

    it("refuses to reassign a run the partner has already accepted", async () => {
      const unique = Date.now() + 4
      const a = await createPartner("assign-accepted", unique)
      const b = await createPartner("assign-accepted-b", unique)
      const designId = await createDesign(unique, "Accepted")
      const runId = await createAssignedRun(designId, a.partnerId)

      // Put the run in the accepted state directly through the module service.
      // Driving it via dispatch → accept would depend on the async, template-
      // driven dispatch chain landing first; when it doesn't, the run is never
      // accepted and the guard under test silently isn't exercised.
      const runService: any = getContainer().resolve("production_runs")
      await runService.updateProductionRuns({
        id: runId,
        status: "in_progress",
        accepted_at: new Date(),
      })

      const before = await getRun(runId)
      expect(before.accepted_at).toBeTruthy()

      const res = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        { partner_id: b.partnerId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(400)

      const run = await getRun(runId)
      expect(run.partner_id).toBe(a.partnerId)
    })

    it("assigns a different partner before acceptance (plain correction, not a recovery)", async () => {
      const unique = Date.now() + 5
      const a = await createPartner("assign-correct-a", unique)
      const b = await createPartner("assign-correct-b", unique)
      const designId = await createDesign(unique, "Correction")
      const runId = await createAssignedRun(designId, a.partnerId)

      // No decline — the run is simply `approved` and pointed at the wrong
      // partner. `assign_partner_from` covers this too.
      const res = await api.post(
        `/admin/production-runs/${runId}/assign-partner`,
        { partner_id: b.partnerId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(200)
      expect(res.data.same_partner).toBe(false)

      const run = await getRun(runId)
      expect(run.partner_id).toBe(b.partnerId)
      expect(run.previous_partner_id).toBe(a.partnerId)
      expect(run.status).toBe("approved")
    })
  })
})
