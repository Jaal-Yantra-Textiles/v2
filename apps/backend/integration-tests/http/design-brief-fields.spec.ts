import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

// Roadmap #604 — Design Brief, Slice A (model + migration).
// Verifies the new brief columns (concept_theme, persona, competitors,
// price_point, design_budget) persist + round-trip through the design module
// service. Slice A deliberately has NO admin/partner validators yet, so we
// exercise the model directly via the service (the validators land in slice B).
setupSharedTestSuite(() => {
  describe("design brief fields (model + migration)", () => {
    it("persists and round-trips all brief fields on create", async () => {
      const { getContainer } = getSharedTestEnv()
      const designService: any = getContainer().resolve(DESIGN_MODULE)

      const persona = {
        age_range: "25-34",
        lifestyle: "urban minimalist",
        values: ["sustainability", "craft"],
        pain_points: ["fast-fashion fatigue"],
      }
      const competitors = [
        { name: "Acme Knits", url: "https://acme.example", differentiator: "hand-loomed" },
        { name: "Bolt Co", differentiator: "lower price" },
      ]

      const created = await designService.createDesigns({
        name: `Brief Design ${Date.now()}`,
        description: "90s Tokyo streetwear capsule",
        design_type: "Original",
        status: "Conceptual",
        priority: "Medium",
        // brief fields
        concept_theme: "90s Tokyo Streetwear",
        persona,
        competitors,
        price_point: "mid_market",
        design_budget: 5000,
        cost_currency: "inr",
      })

      const fetched = await designService.retrieveDesign(created.id)

      expect(fetched.concept_theme).toBe("90s Tokyo Streetwear")
      expect(fetched.persona).toEqual(persona)
      expect(fetched.competitors).toEqual(competitors)
      expect(fetched.price_point).toBe("mid_market")
      // bigNumber columns come back as numeric strings/numbers — compare loosely
      expect(Number(fetched.design_budget)).toBe(5000)
      // design_budget is distinct from the manufacturing cost columns
      expect(fetched.estimated_cost ?? null).toBeNull()
    })

    it("allows brief fields to be null/omitted (all nullable)", async () => {
      const { getContainer } = getSharedTestEnv()
      const designService: any = getContainer().resolve(DESIGN_MODULE)

      const created = await designService.createDesigns({
        name: `Bare Design ${Date.now()}`,
        description: "no brief yet",
        design_type: "Original",
        status: "Conceptual",
        priority: "Medium",
      })
      const fetched = await designService.retrieveDesign(created.id)

      expect(fetched.concept_theme ?? null).toBeNull()
      expect(fetched.persona ?? null).toBeNull()
      expect(fetched.competitors ?? null).toBeNull()
      expect(fetched.price_point ?? null).toBeNull()
      expect(fetched.design_budget ?? null).toBeNull()
    })

    it("updates brief fields on an existing design", async () => {
      const { getContainer } = getSharedTestEnv()
      const designService: any = getContainer().resolve(DESIGN_MODULE)

      const created = await designService.createDesigns({
        name: `Update Brief ${Date.now()}`,
        description: "start bare",
        design_type: "Original",
        status: "Conceptual",
        priority: "Medium",
      })

      await designService.updateDesigns({
        id: created.id,
        concept_theme: "Minimalist Japandi Tech",
        price_point: "luxury",
        design_budget: 12000,
      })

      const fetched = await designService.retrieveDesign(created.id)
      expect(fetched.concept_theme).toBe("Minimalist Japandi Tech")
      expect(fetched.price_point).toBe("luxury")
      expect(Number(fetched.design_budget)).toBe(12000)
    })
  })
})
