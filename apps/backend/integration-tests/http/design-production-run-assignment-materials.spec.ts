import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120 * 1000)

/**
 * Per-assignment materials, arriving by the DESIGN door.
 *
 * `approveProductionRunWorkflow` has understood `materials` since #1361, and
 * `POST /admin/designs/:id/production-runs` hands it `assignments` verbatim —
 * so the feature looked, from the workflow's side, like it already worked here.
 * It did not: the route's own validator never declared `materials`, and the
 * validator is strict, so the field could not reach the handler that was
 * already right about it.
 *
 * 🔑 That gap is invisible to everything except a request. tsc types the
 * payload the UI builds, not the schema it is checked against; the workflow's
 * unit tests feed it materials directly and pass. Only an HTTP round trip that
 * asks the run back for its allocation can tell the difference between "the
 * field was honoured" and "the field was thrown away at the door".
 */
setupSharedTestSuite(() => {
  describe("Design → production run assignments carry per-partner materials", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "Welcome {{partner_name}}",
            html_content: "<div>{{temp_password}}</div>",
            from: "partners@jaalyantra.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        // Already seeded by a sibling spec — either way it exists now.
      }
    })

    /** A design with two inventory items linked, and a partner to send them to. */
    const seed = async (unique: number) => {
      const { api } = getSharedTestEnv()

      const partnerRes = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `Materials Partner ${unique}`,
            handle: `materials-partner-${unique}`,
          },
          admin: {
            email: `materials-partner-${unique}@jyt.test`,
            first_name: "Mat",
            last_name: "Partner",
          },
        },
        adminHeaders
      )
      expect(partnerRes.status).toBe(201)

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Materials Design ${unique}`,
          description: "Design whose BOM is split between partners",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)

      const warpRes = await api.post(
        "/admin/inventory-items",
        { title: `Warp yarn ${unique}` },
        adminHeaders
      )
      expect(warpRes.status).toBe(200)

      const weftRes = await api.post(
        "/admin/inventory-items",
        { title: `Weft yarn ${unique}` },
        adminHeaders
      )
      expect(weftRes.status).toBe(200)

      const designId = designRes.data.design.id
      const warpId = warpRes.data.inventory_item.id
      const weftId = weftRes.data.inventory_item.id

      const linkRes = await api.post(
        `/admin/designs/${designId}/inventory`,
        { inventoryIds: [warpId, weftId] },
        adminHeaders
      )
      expect(linkRes.status).toBe(201)

      return {
        partnerId: partnerRes.data.partner.id,
        designId,
        warpId,
        weftId,
      }
    }

    it("issues only the selected inventory item to that partner's child run", async () => {
      const { api } = getSharedTestEnv()
      const { partnerId, designId, warpId, weftId } = await seed(Date.now())

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 4,
          assignments: [
            {
              partner_id: partnerId,
              quantity: 4,
              role: "weaving",
              // The warp only. The weft is on the design's BOM and is
              // deliberately NOT issued to this partner.
              materials: [
                { inventory_item_id: warpId, planned_quantity: 2.5 },
              ],
            },
          ],
        },
        adminHeaders
      )

      expect(createRes.status).toBe(201)
      expect(createRes.data.children).toHaveLength(1)

      const childId = createRes.data.children[0].id
      const detail = await api.get(
        `/admin/production-runs/${childId}`,
        adminHeaders
      )

      expect(detail.status).toBe(200)
      // 🔑 `materials` and `materials_constrained` are TOP-LEVEL on this
      // response, NOT fields on `production_run`. Reading them off the run
      // gives `undefined` — an absence indistinguishable from "no materials".
      const run = detail.data

      // The whole point: constrained, to exactly one of the two BOM items.
      expect(run.materials_constrained).toBe(true)
      expect(run.materials).toHaveLength(1)
      expect(run.materials[0].inventory_item_id).toBe(warpId)
      // 🔴 2.5, not 3. The link column was `numeric(10,0)` — scale ZERO — so
      // Postgres rounded every fractional allocation on the way in while the
      // picker offered a `step="0.01"` box. Half a metre of silk is an
      // ordinary quantity here; this assertion is what holds the column open.
      expect(Number(run.materials[0].planned_quantity)).toBe(2.5)
      expect(
        run.materials.map((m: any) => m.inventory_item_id)
      ).not.toContain(weftId)
    })

    // The unconstrained case has to keep working unchanged: every run created
    // before the picker existed sent no `materials` at all, and those partners
    // may log consumption against the whole bill of materials.
    it("leaves the run unconstrained when no materials are selected", async () => {
      const { api } = getSharedTestEnv()
      const { partnerId, designId } = await seed(Date.now() + 1)

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          quantity: 3,
          assignments: [{ partner_id: partnerId, quantity: 3, role: "weaving" }],
        },
        adminHeaders
      )

      expect(createRes.status).toBe(201)

      const detail = await api.get(
        `/admin/production-runs/${createRes.data.children[0].id}`,
        adminHeaders
      )

      expect(detail.status).toBe(200)
      expect(detail.data.materials_constrained).toBe(false)
      expect(detail.data.materials).toHaveLength(0)
    })

    // The refusal has to come from the route, not from a partial write: an
    // item that is not on the design's BOM cannot be issued to anyone.
    it("refuses an inventory item that is not on the design's bill of materials", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now() + 2
      const { partnerId, designId } = await seed(unique)

      const strayRes = await api.post(
        "/admin/inventory-items",
        { title: `Unrelated buttons ${unique}` },
        adminHeaders
      )
      expect(strayRes.status).toBe(200)

      const createRes = await api
        .post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 2,
            assignments: [
              {
                partner_id: partnerId,
                quantity: 2,
                materials: [
                  { inventory_item_id: strayRes.data.inventory_item.id },
                ],
              },
            ],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(createRes.status).toBe(400)
    })
  })
})
