import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

const testDesign = {
  name: "Link Test Design",
  description: "Design for testing customer linking",
  design_type: "Original",
  status: "Conceptual",
  priority: "Medium",
  target_completion_date: new Date("2026-12-31"),
  tags: ["test"],
  estimated_cost: 1500,
}

const testDesign2 = {
  name: "Link Test Design 2",
  description: "Second design for multi-link tests",
  design_type: "Custom",
  status: "In_Development",
  priority: "High",
  target_completion_date: new Date("2026-12-31"),
  tags: ["test", "multi"],
  estimated_cost: 2500,
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Design-Customer Module Links", () => {
    let headers: any
    let designId: string
    let designId2: string
    let customerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      // Create two designs
      const res1 = await api.post("/admin/designs", testDesign, headers)
      designId = res1.data.design.id

      const res2 = await api.post("/admin/designs", testDesign2, headers)
      designId2 = res2.data.design.id

      // Create a customer
      const customerRes = await api.post(
        "/admin/customers",
        {
          first_name: "Link",
          last_name: "Tester",
          email: `link-test-${Date.now()}@test.com`,
        },
        headers
      )
      customerId = customerRes.data.customer.id
    })

    describe("POST /admin/customers/:id/designs", () => {
      it("🔴 replaces the commissioner instead of appending a second one", async () => {
        /*
         * `design ↔ customer` answers "whose design is this" — ONE commissioner.
         * Who has BOUGHT a design is a different question, answered through its
         * runs and their orders.
         *
         * This route used to APPEND, so a design could end up carrying two
         * customers, and then the answer depended on which surface read it
         * first: the designs list takes the first row, the design-status email
         * workflow takes `take: 1`. Two screens could name two different people,
         * and a client could be sent mail about someone else's piece.
         */
        const other = await api.post(
          "/admin/customers",
          {
            first_name: "Other",
            last_name: "Buyer",
            email: `other-${Date.now()}@test.com`,
          },
          headers
        )

        await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId] },
          headers
        )
        const second = await api.post(
          `/admin/customers/${other.data.customer.id}/designs`,
          { design_ids: [designId] },
          headers
        )

        expect(second.data.replaced).toBe(1)

        const detail = await api.get(
          `/admin/designs/${designId}?fields=*,customers.*`,
          headers
        )
        const linked = (detail.data.design.customers || []).filter(Boolean)
        expect(linked).toHaveLength(1)
        expect(linked[0].id).toBe(other.data.customer.id)
      })

      it("should link a single design to a customer", async () => {
        const res = await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId] },
          headers
        )

        expect(res.status).toBe(200)
        expect(res.data.linked).toBe(1)
      })

      it("should link multiple designs to a customer", async () => {
        const res = await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId, designId2] },
          headers
        )

        expect(res.status).toBe(200)
        expect(res.data.linked).toBe(2)
      })

      it("should reject empty design_ids array", async () => {
        const res = await api
          .post(
            `/admin/customers/${customerId}/designs`,
            { design_ids: [] },
            headers
          )
          .catch((err) => err.response)

        expect(res.status).toBe(400)
      })
    })

    describe("GET /admin/designs?customer_id=", () => {
      it("should return linked designs for a customer", async () => {
        // Link designs
        await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId, designId2] },
          headers
        )

        // Fetch designs for this customer
        const res = await api.get(
          `/admin/designs?customer_id=${customerId}`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.designs.length).toBe(2)

        const names = res.data.designs.map((d: any) => d.name)
        expect(names).toContain("Link Test Design")
        expect(names).toContain("Link Test Design 2")
      })

      it("should return empty for customer with no designs", async () => {
        const res = await api.get(
          `/admin/designs?customer_id=${customerId}`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.designs.length).toBe(0)
      })
    })

    describe("GET /admin/designs/:id — module link traversal", () => {
      it("should not crash when requesting customer.* fields on a linked design", async () => {
        // Link design to customer
        await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId] },
          headers
        )

        // Fetch design with customer fields — should not 500
        const res = await api.get(
          `/admin/designs/${designId}?fields=*,customer.*`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.design).toBeDefined()
        expect(res.data.design.id).toBe(designId)
        expect(res.data.design.name).toBe("Link Test Design")
      })

      it("should not crash when requesting customer fields on unlinked design", async () => {
        const res = await api.get(
          `/admin/designs/${designId}?fields=*,customer.*`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.design).toBeDefined()
        expect(res.data.design.id).toBe(designId)
      })

      it("should resolve inventory_items via model relation", async () => {
        const res = await api.get(
          `/admin/designs/${designId}?fields=*,inventory_items.*`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.design).toBeDefined()
        expect(res.data.design.id).toBe(designId)
      })

      it("should handle mixed model + link fields without crashing", async () => {
        // Link design to customer
        await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId] },
          headers
        )

        // Request both model relations and link fields
        const res = await api.get(
          `/admin/designs/${designId}?fields=*,colors.*,size_sets.*,customer.*`,
          { headers: headers.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.design).toBeDefined()
        expect(res.data.design.id).toBe(designId)
        expect(res.data.design).toHaveProperty("colors")
        expect(res.data.design).toHaveProperty("size_sets")
      })
    })

    describe("Design-Customer link with create (customer_id_for_link)", () => {
      it("should auto-link design to customer on creation", async () => {
        const res = await api.post(
          "/admin/designs",
          {
            ...testDesign,
            name: `Auto-linked Design ${Date.now()}`,
            customer_id_for_link: customerId,
          },
          headers
        )

        expect(res.status).toBe(201)
        const newDesignId = res.data.design.id

        // Verify the design shows up in customer's designs
        const listRes = await api.get(
          `/admin/designs?customer_id=${customerId}`,
          { headers: headers.headers }
        )

        expect(listRes.status).toBe(200)
        const designIds = listRes.data.designs.map((d: any) => d.id)
        expect(designIds).toContain(newDesignId)
      })
    })

    /**
     * The welcome letter (`design-assigned`) goes out when a customer is
     * ASSOCIATED with a design — not only when a design is created with one.
     * Attaching a customer to an existing design used to send nothing.
     */
    describe("welcome letter on association", () => {
      const watchAssigned = () => {
        const { Modules } = require("@medusajs/framework/utils")
        const eventBus: any = getContainer().resolve(Modules.EVENT_BUS)
        const seen: any[] = []
        const handler = async (payload: any) => {
          seen.push(payload?.data ?? payload)
        }
        eventBus.subscribe("design.assigned", handler)
        return {
          seen,
          settle: async (n: number) => {
            for (let i = 0; i < 25 && seen.length < n; i++) {
              await new Promise((r) => setTimeout(r, 200))
            }
            // Give a stray duplicate the chance to arrive before asserting.
            await new Promise((r) => setTimeout(r, 400))
          },
          stop: () => eventBus.unsubscribe?.("design.assigned", handler),
        }
      }

      it("POST /admin/designs/:id/customer welcomes a new customer once", async () => {
        const watch = watchAssigned()
        try {
          const first = await api.post(
            `/admin/designs/${designId}/customer`,
            { customer_id: customerId },
            headers
          )
          expect(first.status).toBe(200)
          await watch.settle(1)
          expect(watch.seen.filter((d) => d.design_id === designId)).toEqual([
            expect.objectContaining({
              design_id: designId,
              customer_id: customerId,
              design_name: testDesign.name,
            }),
          ])

          // Same customer again: a no-op, and no second letter.
          const again = await api.post(
            `/admin/designs/${designId}/customer`,
            { customer_id: customerId },
            headers
          )
          expect(again.data.design_customer.changed).toBe(false)
          await watch.settle(2)
          expect(watch.seen.filter((d) => d.design_id === designId)).toHaveLength(1)
        } finally {
          watch.stop()
        }
      })

      it("POST /admin/customers/:id/designs welcomes only newly linked designs", async () => {
        await api.post(
          `/admin/customers/${customerId}/designs`,
          { design_ids: [designId] },
          headers
        )

        const watch = watchAssigned()
        try {
          await api.post(
            `/admin/customers/${customerId}/designs`,
            { design_ids: [designId, designId2] },
            headers
          )
          await watch.settle(1)
          expect(watch.seen.map((d) => d.design_id)).toEqual([designId2])
        } finally {
          watch.stop()
        }
      })
    })
  })
})
