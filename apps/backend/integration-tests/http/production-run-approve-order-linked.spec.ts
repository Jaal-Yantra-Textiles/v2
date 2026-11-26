import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"

jest.setTimeout(90 * 1000)

/**
 * #2646 — a run linked to an order line (as every `order.placed` run is) must
 * be approvable. Approval's children copy the parent's `order_line_item_id`;
 * the #1123 unique index used to make the first child collide with its parent
 * ("Production runs with order_line_item_id … already exists").
 *
 * The #1123 guarantee still holds for top-level runs: a second top-level run
 * for the same line is refused.
 */
setupSharedTestSuite(() => {
  describe("Approving an order-linked production run", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createPartner(unique: number) {
      const email = `approve-linked-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login = await api.post("/auth/partner/emailpass", { email, password })
      const res = await api.post(
        "/partners",
        {
          name: `Approve Linked ${unique}`,
          handle: `approve-linked-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      expect(res.status).toBe(200)
      return res.data.partner.id as string
    }

    async function createDesign(unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Approve Linked ${unique}`,
          description: "Design used by the #2646 order-linked approval spec",
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

    it("approves a run carrying an order line, and the child keeps the line", async () => {
      const unique = Date.now()
      const partnerId = await createPartner(unique)
      const designId = await createDesign(unique)
      const orderId = `order_test_${unique}`
      const lineId = `ordli_test_${unique}`

      const parent = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 1, order_id: orderId, order_line_item_id: lineId },
        adminHeaders
      )
      expect(parent.status).toBe(201)

      const approve = await api.post(
        `/admin/production-runs/${parent.data.production_run.id}/approve`,
        { assignments: [{ partner_id: partnerId, role: "stitching", quantity: 1 }] },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect([approve.status, approve.data?.message]).toEqual([200, undefined])

      const children = await api.get(
        `/admin/production-runs?parent_run_id=${parent.data.production_run.id}`,
        adminHeaders
      )
      expect(children.status).toBe(200)
      const runs = children.data.production_runs
      expect(runs).toHaveLength(1)
      expect(runs[0].partner_id).toBe(partnerId)
      expect(runs[0].order_line_item_id).toBe(lineId)
      expect(runs[0].order_id).toBe(orderId)
    })

    it("still refuses a second TOP-LEVEL run for the same order line (#1123)", async () => {
      const unique = Date.now()
      const designId = await createDesign(unique)
      const lineId = `ordli_dup_${unique}`

      const first = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 1, order_line_item_id: lineId },
        adminHeaders
      )
      expect(first.status).toBe(201)

      const second = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 1, order_line_item_id: lineId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(second.status).toBe(400)
      expect(String(second.data?.message)).toMatch(/already exists/)
    })
  })
})
