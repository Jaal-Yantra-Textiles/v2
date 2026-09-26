/**
 * #2306 S3 — a work order waits for a partner.
 *
 * A run created without a partner is a plan: it gets NO work order. Minting one
 * there is what made every split cancel a "superseded" order (51 of 52 split
 * parents on prod had no partner of their own). The work order now appears
 * where the work is given to someone — on the stages when the run is split, or
 * when the run itself is first dispatched to a partner.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { fetchRunSupersessions } from "../../src/workflows/payment_submissions/lib/run-supersession"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("A work order waits for a partner (#2306 S3)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`
        )
      }
    }

    const createPartner = async (label: string) => {
      const email = `wo-wait-${label}-${unique}@jyt.test`
      const password = "supersecret"
      await post("/auth/partner/emailpass/register", { email, password })
      const first = await post("/auth/partner/emailpass", { email, password })
      const res = await post(
        "/partners",
        {
          name: `WO Wait ${label} ${unique}`,
          handle: `wo-wait-${label}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${first.data.token}` } }
      )
      const fresh = await post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        headers: { headers: { Authorization: `Bearer ${fresh.data.token}` } },
      }
    }

    const createTemplate = async () => {
      const name = `wo-wait-${unique}`
      await post(
        "/admin/task-templates",
        {
          name,
          description: "template",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "WO Wait Test",
        },
        adminHeaders
      )
      return name
    }

    const createDesign = async () => {
      const res = await post(
        "/admin/designs",
        { name: `WO Wait ${unique}`, design_type: "Original", status: "Approved", priority: "Medium" },
        adminHeaders
      )
      return res.data.design.id as string
    }

    const createRun = async (designId: string, partnerId?: string) => {
      const res = await post(
        "/admin/production-runs",
        { design_id: designId, quantity: 2, ...(partnerId ? { partner_id: partnerId } : {}) },
        adminHeaders
      )
      return res.data.production_run.id as string
    }

    const workOrderOf = async (runId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "production_runs",
        filters: { id: runId },
        fields: ["id", "order.id", "order.status"],
      })
      return (data?.[0]?.order ?? null) as { id: string; status: string } | null
    }

    const listedFor = async (headers: any) => {
      const res = await api.get("/partners/orders?kind=design&limit=100", headers)
      return (res.data.orders || []).map((o: any) => String(o.id))
    }

    beforeAll(() => {
      process.env.WORK_ORDER_READS = "true"
    })
    afterAll(() => {
      delete process.env.WORK_ORDER_READS
    })

    beforeEach(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await ensureHouseStoreRegion(getContainer())
    })

    it("a run created with no partner gets no work order; its stages do, and nothing is superseded", async () => {
      const a = await createPartner("split-a")
      const runId = await createRun(await createDesign())

      expect(await workOrderOf(runId)).toBeNull()

      const approve = await post(
        `/admin/production-runs/${runId}/approve`,
        { assignments: [{ partner_id: a.partnerId, role: "stitching", quantity: 2 }] },
        adminHeaders
      )
      const child = (approve.data.result?.children || [])[0]
      expect(child?.id).toBeTruthy()

      // The stage carries the work order; the plan still has none — so there
      // is no canceled "superseded" order left behind for payouts to untangle.
      expect(await workOrderOf(child.id)).toBeTruthy()
      expect(await workOrderOf(runId)).toBeNull()
    })

    it("a run with a partner still gets its work order at creation", async () => {
      const a = await createPartner("direct-a")
      const runId = await createRun(await createDesign(), a.partnerId)
      expect(await workOrderOf(runId)).toBeTruthy()
    })

    it("a partnerless run approved unsplit gets its work order when first dispatched", async () => {
      const template = await createTemplate()
      const b = await createPartner("later-b")
      const runId = await createRun(await createDesign())

      await post(`/admin/production-runs/${runId}/approve`, {}, adminHeaders)
      expect(await workOrderOf(runId)).toBeNull()

      await post(`/admin/production-runs/${runId}/assign-partner`, { partner_id: b.partnerId }, adminHeaders)
      expect(await workOrderOf(runId)).toBeNull()

      await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)

      const wo = await workOrderOf(runId)
      expect(wo).toBeTruthy()
      expect(await listedFor(b.headers)).toContain(wo!.id)
    })

    it("a partnered parent with stages but no work order is superseded by them for payouts", async () => {
      // `recreate-production-run` makes exactly this: a parent AND its stages
      // all carrying the partner, and no work order on any of them. "No order
      // → bill it" paid the parent beside its stages (the #2026 shape); the
      // payout guard now reads the stages instead.
      const owner = await createPartner("bundle")
      const res = await post(
        "/admin/designs/recreate-production-run",
        {
          designs: [
            { design_id: await createDesign(), quantity: 1 },
            { design_id: await createDesign(), quantity: 1 },
          ],
          partner_id: owner.partnerId,
        },
        adminHeaders
      )
      const parentId = res.data.production_run.id as string
      const childIds = (res.data.children || []).map((c: any) => c.id as string)
      expect(childIds).toHaveLength(2)
      expect(await workOrderOf(parentId)).toBeNull()

      const verdicts = await fetchRunSupersessions(getContainer() as any, [parentId, ...childIds])
      expect(verdicts.get(parentId)?.reason).toBe("superseded_run")
      expect([...(verdicts.get(parentId)?.superseded_by_run_ids ?? [])].sort()).toEqual([...childIds].sort())
      for (const id of childIds) expect(verdicts.has(id)).toBe(false)
    })
  })
})
