import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"

jest.setTimeout(60 * 1000)

// Regression: a cancelled partner assignment followed by a NEW production
// run for the same partner must not leave the design stuck at
// partner_status="cancelled". Two safeguards are exercised:
//  1. approveProductionRunWorkflow clears the stale
//     design.metadata.partner_assignment_cancelled_at marker on re-assign.
//  2. the /partners/designs[/:id] derivation treats the cancel marker as
//     superseded by a run created after the cancellation (read-time heal).
setupSharedTestSuite(() => {
  describe("Partner cancel → re-assign desync", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createPartner(unique: number) {
      const email = `cancel-desync-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `Cancel Desync ${unique}`,
          handle: `cancel-desync-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
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
      // template used by the partner-created subscriber (ignore failures)
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

    it("clears the cancel marker and restores partner_status on re-assignment", async () => {
      const unique = Date.now()
      const { partnerId, partnerHeaders } = await createPartner(unique)

      const designRes = await api.post(
        "/admin/designs",
        { name: `Cancel Desync Design ${unique}`, description: "x", design_type: "Original", status: "Conceptual", priority: "Medium" },
        adminHeaders
      )
      const designId = designRes.data.design.id

      // Run #1 assigned to the partner — auto-links (design,partner) (#27)
      const run1 = await api.post(
        `/admin/designs/${designId}/production-runs`,
        { run_type: "production", quantity: 2, assignments: [{ partner_id: partnerId, quantity: 2 }] },
        adminHeaders
      )
      expect(run1.status).toBe(201)
      const run1ChildId = run1.data.children?.[0]?.id

      // Cancel the partner assignment → sets partner_assignment_cancelled_at
      const cancelRes = await api.post(
        `/admin/designs/${designId}/cancel-partner-assignment`,
        { partner_id: partnerId },
        adminHeaders
      )
      expect(cancelRes.status).toBeLessThan(300)

      // Cancelling the assignment must also cancel the partner's active run
      // (so no non-terminal run lingers for the partner to keep working).
      if (run1ChildId) {
        const runDoc = await api.get(`/admin/production-runs/${run1ChildId}`, adminHeaders)
        expect(runDoc.data.production_run?.status).toBe("cancelled")
      }

      // Run #1 predates the cancel, so it must NOT supersede it — design
      // reports cancelled for the partner.
      const afterCancel = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders })
      expect(afterCancel.data.design?.partner_info?.partner_status).toBe("cancelled")

      // Re-assign via a NEW production run (created after the cancel)
      const run2 = await api.post(
        `/admin/designs/${designId}/production-runs`,
        { run_type: "production", quantity: 3, assignments: [{ partner_id: partnerId, quantity: 3 }] },
        adminHeaders
      )
      expect(run2.status).toBe(201)

      // partner_status must no longer be "cancelled" (marker cleared on
      // approve + superseded by the newer run at read time)
      const afterReassign = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders })
      expect(afterReassign.data.design?.partner_info?.partner_status).not.toBe("cancelled")

      // and the stale marker is gone from metadata
      const designDoc = await api.get(`/admin/designs/${designId}?fields=id,metadata`, adminHeaders)
      const meta = designDoc.data.design?.metadata || {}
      expect(meta.partner_assignment_cancelled_at == null).toBe(true)
    })

    it("derives partner_status='cancelled' purely from a cancelled run (no marker)", async () => {
      const unique = Date.now() + 1
      const { partnerId, partnerHeaders } = await createPartner(unique)

      const designRes = await api.post(
        "/admin/designs",
        { name: `Run Cancel SSOT ${unique}`, description: "x", design_type: "Original", status: "Conceptual", priority: "Medium" },
        adminHeaders
      )
      const designId = designRes.data.design.id

      const run = await api.post(
        `/admin/designs/${designId}/production-runs`,
        { run_type: "production", quantity: 1, assignments: [{ partner_id: partnerId, quantity: 1 }] },
        adminHeaders
      )
      expect(run.status).toBe(201)
      const childId = run.data.children?.[0]?.id
      expect(childId).toBeTruthy()

      // Cancel the RUN directly (not the assignment) — no metadata marker
      // is set. Single source of truth: the cancelled run alone must yield
      // partner_status = "cancelled".
      const cancelRun = await api.post(
        `/admin/production-runs/${childId}/cancel`,
        { reason: "test" },
        adminHeaders
      )
      expect(cancelRun.status).toBeLessThan(300)

      const detail = await api.get(`/partners/designs/${designId}`, { headers: partnerHeaders })
      expect(detail.data.design?.partner_info?.partner_status).toBe("cancelled")

      // No marker was ever set — proves it's derived from the run, not metadata.
      const designDoc = await api.get(`/admin/designs/${designId}?fields=id,metadata`, adminHeaders)
      expect((designDoc.data.design?.metadata || {}).partner_assignment_cancelled_at == null).toBe(true)
    })
  })
})
