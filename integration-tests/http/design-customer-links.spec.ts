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
  })
})
