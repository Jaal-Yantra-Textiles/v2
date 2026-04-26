import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60000)

const baseDesign = {
  name: "Revision Test Design",
  description: "A design to test the revision flow",
  design_type: "Original" as const,
  status: "Approved" as const,
  priority: "High" as const,
  tags: ["test", "revision"],
  estimated_cost: 5000,
  designer_notes: "Original design notes",
  colors: [
    { name: "Red", hex_code: "#FF0000", usage_notes: "Primary", order: 1 },
    { name: "Blue", hex_code: "#0000FF", usage_notes: "Accent", order: 2 },
  ],
  size_sets: [
    { size_label: "S", measurements: { chest: 36, length: 28 } },
    { size_label: "M", measurements: { chest: 38, length: 29 } },
  ],
}

setupSharedTestSuite(() => {
  describe("Design Revisions API", () => {
    const { api, getContainer } = getSharedTestEnv()

    let headers: any
    let designId: string
    let partnerId: string

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
    })

    beforeEach(async () => {
      // Create a fresh design for each test
      const designRes = await api.post("/admin/designs", baseDesign, headers)
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id

      // Create a partner and link to design
      const unique = Date.now()
      const partnerRes = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `Revision Test Partner ${unique}`,
            handle: `revision-partner-${unique}`,
          },
          admin: {
            email: `rev-partner-${unique}@jyt.test`,
            first_name: "Rev",
            last_name: "Partner",
          },
        },
        headers
      )
      expect(partnerRes.status).toBe(201)
      partnerId = partnerRes.data.partner.id

      // Link partner to design
      const linkRes = await api.post(
        `/admin/designs/${designId}/partner`,
        { partnerIds: [partnerId] },
        headers
      )
      expect(linkRes.status).toBeGreaterThanOrEqual(200)
      expect(linkRes.status).toBeLessThan(300)
    })

    describe("POST /admin/designs/:id/revise", () => {
      it("should create a revised design from an approved design", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/revise`,
          {
            revision_notes: "Changing embroidery pattern per client feedback",
          },
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.design).toBeDefined()
        expect(response.data.design.id).not.toBe(designId)
        expect(response.data.design.revised_from_id).toBe(designId)
        expect(response.data.design.revision_number).toBe(2)
        expect(response.data.design.revision_notes).toBe(
          "Changing embroidery pattern per client feedback"
        )
        expect(response.data.design.status).toBe("In_Development")
        // Name and other fields are cloned
        expect(response.data.design.name).toBe(baseDesign.name)
        expect(response.data.design.priority).toBe(baseDesign.priority)

        // Original design should be superseded
        const originalRes = await api.get(`/admin/designs/${designId}`, {
          headers: headers.headers,
        })
        expect(originalRes.data.design.status).toBe("Superseded")
      })

      it("should apply overrides when revising", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/revise`,
          {
            revision_notes: "Updated design with new name and priority",
            overrides: {
              name: "Revision Test Design v2",
              priority: "Urgent",
              designer_notes: "Revised with urgent priority",
            },
          },
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.design.name).toBe("Revision Test Design v2")
        expect(response.data.design.priority).toBe("Urgent")
        expect(response.data.design.designer_notes).toBe(
          "Revised with urgent priority"
        )
        // Still tracks revision lineage
        expect(response.data.design.revised_from_id).toBe(designId)
        expect(response.data.design.revision_number).toBe(2)
      })

      it("should copy partner links to the revised design", async () => {
        const reviseRes = await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "Testing partner link copy" },
          headers
        )

        const newDesignId = reviseRes.data.design.id

        // Check new design has partners
        const newDesignRes = await api.get(
          `/admin/designs/${newDesignId}?fields=partners.*`,
          { headers: headers.headers }
        )

        expect(newDesignRes.status).toBe(200)
        const partners = newDesignRes.data.design.partners || []
        expect(partners.length).toBeGreaterThanOrEqual(1)
        expect(partners.map((p: any) => p.id)).toContain(partnerId)
      })

      it("should clone colors and size sets to the revised design", async () => {
        const reviseRes = await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "Testing color/size clone" },
          headers
        )

        const newDesignId = reviseRes.data.design.id

        const newDesignRes = await api.get(`/admin/designs/${newDesignId}`, {
          headers: headers.headers,
        })

        expect(newDesignRes.status).toBe(200)
        const design = newDesignRes.data.design

        // Verify colors are cloned
        expect(design.colors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Red", hex_code: "#FF0000" }),
            expect.objectContaining({ name: "Blue", hex_code: "#0000FF" }),
          ])
        )

        // Verify size sets are cloned
        expect(design.size_sets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              size_label: "S",
              measurements: { chest: 36, length: 28 },
            }),
            expect.objectContaining({
              size_label: "M",
              measurements: { chest: 38, length: 29 },
            }),
          ])
        )
      })

      it("should reject revision of a Superseded design", async () => {
        // First revision
        await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "First revision" },
          headers
        )

        // Try to revise the now-superseded original
        const response = await api
          .post(
            `/admin/designs/${designId}/revise`,
            { revision_notes: "Should fail" },
            headers
          )
          .catch((err) => err.response)

        expect(response.status).toBe(400)
      })

      it("should reject revision of a Conceptual design", async () => {
        // Create a conceptual design
        const conceptualRes = await api.post(
          "/admin/designs",
          { ...baseDesign, status: "Conceptual", name: "Conceptual Design" },
          headers
        )
        const conceptualId = conceptualRes.data.design.id

        const response = await api
          .post(
            `/admin/designs/${conceptualId}/revise`,
            { revision_notes: "Should fail" },
            headers
          )
          .catch((err) => err.response)

        expect(response.status).toBe(400)
      })

      it("should reject revision without revision_notes", async () => {
        const response = await api
          .post(`/admin/designs/${designId}/revise`, {}, headers)
          .catch((err) => err.response)

        expect(response.status).toBe(400)
      })

      it("should support chained revisions (A → B → C)", async () => {
        // Revise A → B
        const revB = await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "Revision B from A" },
          headers
        )
        expect(revB.status).toBe(200)
        const designBId = revB.data.design.id
        expect(revB.data.design.revision_number).toBe(2)

        // Approve B so it can be revised
        await api.put(
          `/admin/designs/${designBId}`,
          { status: "Approved" },
          headers
        )

        // Revise B → C
        const revC = await api.post(
          `/admin/designs/${designBId}/revise`,
          { revision_notes: "Revision C from B" },
          headers
        )
        expect(revC.status).toBe(200)
        expect(revC.data.design.revision_number).toBe(3)
        expect(revC.data.design.revised_from_id).toBe(designBId)

        // B should now be superseded
        const bRes = await api.get(`/admin/designs/${designBId}`, {
          headers: headers.headers,
        })
        expect(bRes.data.design.status).toBe("Superseded")
      })
    })

    describe("GET /admin/designs/:id/revisions", () => {
      it("should return lineage for an original design with no revisions", async () => {
        const response = await api.get(
          `/admin/designs/${designId}/revisions`,
          { headers: headers.headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.design_id).toBe(designId)
        expect(response.data.lineage).toHaveLength(1)
        expect(response.data.lineage[0].id).toBe(designId)
      })

      it("should return full lineage for a revised design", async () => {
        // Create A → B
        const revB = await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "Revision B" },
          headers
        )
        const designBId = revB.data.design.id

        // Query lineage from B
        const response = await api.get(
          `/admin/designs/${designBId}/revisions`,
          { headers: headers.headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.lineage).toHaveLength(2)
        expect(response.data.lineage[0].id).toBe(designId)
        expect(response.data.lineage[1].id).toBe(designBId)
        expect(response.data.root_design_id).toBe(designId)
      })

      it("should return full chain for A → B → C from any node", async () => {
        // A → B
        const revB = await api.post(
          `/admin/designs/${designId}/revise`,
          { revision_notes: "B from A" },
          headers
        )
        const designBId = revB.data.design.id

        // Approve B
        await api.put(
          `/admin/designs/${designBId}`,
          { status: "Approved" },
          headers
        )

        // B → C
        const revC = await api.post(
          `/admin/designs/${designBId}/revise`,
          { revision_notes: "C from B" },
          headers
        )
        const designCId = revC.data.design.id

        // Query from A (root) — should show A + descendants B, C
        const fromA = await api.get(
          `/admin/designs/${designId}/revisions`,
          { headers: headers.headers }
        )
        expect(fromA.data.lineage).toHaveLength(3)
        expect(fromA.data.lineage.map((d: any) => d.id)).toEqual([
          designId,
          designBId,
          designCId,
        ])

        // Query from C (leaf) — should show ancestors A, B + current C
        const fromC = await api.get(
          `/admin/designs/${designCId}/revisions`,
          { headers: headers.headers }
        )
        expect(fromC.data.lineage).toHaveLength(3)
        expect(fromC.data.lineage.map((d: any) => d.id)).toEqual([
          designId,
          designBId,
          designCId,
        ])
      })

      it("should return 404 for non-existent design", async () => {
        const response = await api
          .get("/admin/designs/non-existent-id/revisions", {
            headers: headers.headers,
          })
          .catch((err) => err.response)

        expect(response.status).toBe(404)
      })
    })
  })
})
