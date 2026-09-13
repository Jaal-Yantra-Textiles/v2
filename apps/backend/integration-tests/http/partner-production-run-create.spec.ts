/**
 * Partner-originated production runs (roadmap #6, Phase 4).
 *
 * A partner creates a SELF-APPROVED production run for their own design,
 * in_house or outsourced. execution_mode + sub_partner_id are recorded;
 * outsourced mirrors the design link to the sub-partner.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-production-run-create
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import designPartnersLink from "../../src/links/design-partners-link"

const PARTNER_PASSWORD = "supersecret"
jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `prun-${label}-${unique}@jyt.test`
  await api.post("/auth/partner/emailpass/register", {
    email,
    password: PARTNER_PASSWORD,
  })
  let login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login.data.token}`,
  }
  const partnerRes = await api.post(
    "/partners",
    {
      name: `PRun ${label} ${unique}`,
      handle: `prun-${label}-${unique}`,
      admin: { email, first_name: "Test", last_name: "Partner" },
    },
    { headers }
  )
  expect(partnerRes.status).toBe(200)
  login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login.data.token}` }
  return { partnerId: partnerRes.data.partner.id as string, partnerHeaders: headers }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner-originated production runs (roadmap 6, Phase 4)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
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
      } catch {
        /* pre-existing */
      }
    })

    async function ownDesign(partnerHeaders: any) {
      const res = await api.post(
        "/partners/designs",
        { name: "Run Design", design_type: "Original" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    it("creates a self-approved in_house run owned by the partner", async () => {
      const { partnerId, partnerHeaders } = await createPartner(api, "inhouse")
      const designId = await ownDesign(partnerHeaders)

      const res = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { quantity: 5, execution_mode: "in_house" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(201)
      const run = res.data.production_run
      // Self-approved + self-started → in_progress (ready to work).
      expect(run.status).toBe("in_progress")
      expect(run.execution_mode).toBe("in_house")
      expect(run.partner_id).toBe(partnerId)
      expect(run.sub_partner_id == null).toBe(true)
      expect(Number(run.quantity)).toBe(5)

      // The run shows up in the partner's own run list.
      const list = await api.get("/partners/production-runs?limit=100", {
        headers: partnerHeaders,
      })
      expect(
        (list.data.production_runs || list.data.productionRuns || []).map(
          (r: any) => r.id
        )
      ).toContain(run.id)
    })

    it("creates an outsourced run + mirrors the design link to the sub-partner", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "owner")
      const { partnerId: subId } = await createPartner(api, "vendor")
      const designId = await ownDesign(owner)

      const res = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { quantity: 2, execution_mode: "outsourced", sub_partner_id: subId },
        { headers: owner }
      )
      expect(res.status).toBe(201)
      const run = res.data.production_run
      expect(run.execution_mode).toBe("outsourced")
      expect(run.sub_partner_id).toBe(subId)

      // design → sub-partner link mirrored.
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: links } = await query.graph({
        entity: designPartnersLink.entryPoint,
        filters: { design_id: designId, partner_id: subId },
        fields: ["design_id", "partner_id"],
      })
      expect((links || []).length).toBe(1)
    })

    /**
     * #2028 item 5. The sub-partner is the one actually making the garment, and
     * `cost-summary` + `transfers` already admitted them — run-detail did not,
     * so the same actor got a 404 on the resource whose cost they could read.
     * Founder's call (2026-09-13): the executor may see the run they execute.
     *
     * The second assertion is the one that matters. The route scopes its
     * `query.graph` by partner, and keying that on `partner_id` for a
     * sub-partner returns NOTHING — the handler then falls back to a bare
     * retrieve, which has no `tasks` and no `order.id`. That failure is silent:
     * a 200 with a thinner body. So this asserts the SHAPE, not just the status.
     */
    it("lets the outsourced sub-partner read the run they are executing", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "src")
      const { partnerId: subId, partnerHeaders: sub } = await createPartner(
        api,
        "exec"
      )
      const { partnerHeaders: stranger } = await createPartner(api, "outsider")
      const designId = await ownDesign(owner)

      const created = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { quantity: 1, execution_mode: "outsourced", sub_partner_id: subId },
        { headers: owner }
      )
      expect(created.status).toBe(201)
      const runId = created.data.production_run.id as string

      const asSub = await api.get(`/partners/production-runs/${runId}`, {
        headers: sub,
        validateStatus: () => true,
      })
      expect(asSub.status).toBe(200)
      const seen = asSub.data.production_run || asSub.data.productionRun
      expect(seen.id).toBe(runId)
      expect(seen.sub_partner_id).toBe(subId)
      // The full graph payload, not the bare-retrieve fallback.
      expect(seen).toHaveProperty("tasks")

      // The originator still reads it.
      const asOwner = await api.get(`/partners/production-runs/${runId}`, {
        headers: owner,
        validateStatus: () => true,
      })
      expect(asOwner.status).toBe(200)

      // An unrelated partner is still shut out — widening the scope to the
      // executor must not widen it to everyone.
      const asStranger = await api.get(`/partners/production-runs/${runId}`, {
        headers: stranger,
        validateStatus: () => true,
      })
      expect([401, 403, 404]).toContain(asStranger.status)
    })

    it("rejects outsourced without a sub_partner_id, and blocks non-owners", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "validate")
      const { partnerHeaders: intruder } = await createPartner(api, "intruder")
      const designId = await ownDesign(owner)

      // Missing sub_partner_id on outsourced → 400 validation.
      const bad = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { execution_mode: "outsourced" },
        { headers: owner, validateStatus: () => true }
      )
      expect(bad.status).toBe(400)

      // Non-owner can't create a run on someone else's design.
      const intruderRes = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { execution_mode: "in_house" },
        { headers: intruder, validateStatus: () => true }
      )
      expect([400, 401, 403]).toContain(intruderRes.status)
    })
  })
})
