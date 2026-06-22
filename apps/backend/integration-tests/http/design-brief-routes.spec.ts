/**
 * Roadmap #604 — Design Brief, Slice B (admin CRUD API routes).
 *
 * Exercises GET/POST/PUT /admin/designs/:id/brief end-to-end through the HTTP
 * stack (validators + middleware + update workflow + refetch shaper).
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  let designId: string

  const { api, getContainer } = getSharedTestEnv()

  beforeAll(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  beforeEach(async () => {
    // Fresh bare design per test (the shared harness truncates between files,
    // not between its, but a clean design keeps the brief assertions isolated).
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    const created = await designService.createDesigns({
      name: `Brief Route Design ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      description: "brief route test",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    designId = created.id
  })

  describe("GET /admin/designs/:id/brief", () => {
    it("returns a null brief for a bare design", async () => {
      const res = await api.get(`/admin/designs/${designId}/brief`, headers)
      expect(res.status).toBe(200)
      expect(res.data.brief).toEqual({
        concept_theme: null,
        persona: null,
        competitors: null,
        price_point: null,
        design_budget: null,
        cost_currency: null,
      })
    })

    it("404s for an unknown design", async () => {
      const err = await api
        .get(`/admin/designs/design_does_not_exist/brief`, headers)
        .catch((e) => e)
      expect(err.response.status).toBe(404)
    })
  })

  describe("POST /admin/designs/:id/brief", () => {
    it("replaces the whole brief and reads it back", async () => {
      const persona = {
        age_range: "25-34",
        lifestyle: "urban minimalist",
        values: ["sustainability"],
        pain_points: ["fast-fashion fatigue"],
      }
      const competitors = [
        { name: "Acme Knits", url: "https://acme.example", differentiator: "hand-loomed" },
        { name: "Bolt Co", differentiator: "lower price" },
      ]

      const res = await api.post(
        `/admin/designs/${designId}/brief`,
        {
          concept_theme: "90s Tokyo Streetwear",
          persona,
          competitors,
          price_point: "mid_market",
          design_budget: 5000,
          cost_currency: "inr",
        },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.brief.concept_theme).toBe("90s Tokyo Streetwear")
      expect(res.data.brief.persona).toEqual(persona)
      expect(res.data.brief.competitors).toEqual(competitors)
      expect(res.data.brief.price_point).toBe("mid_market")
      expect(res.data.brief.design_budget).toBe(5000)
      expect(res.data.brief.cost_currency).toBe("inr")

      // GET reflects the persisted brief.
      const get = await api.get(`/admin/designs/${designId}/brief`, headers)
      expect(get.data.brief.concept_theme).toBe("90s Tokyo Streetwear")
      expect(get.data.brief.design_budget).toBe(5000)
    })

    it("nulls out unset fields (full replace)", async () => {
      await api.post(
        `/admin/designs/${designId}/brief`,
        { concept_theme: "First", price_point: "luxury", design_budget: 1000 },
        headers
      )
      // Second POST omits concept_theme/design_budget → they reset to null.
      const res = await api.post(
        `/admin/designs/${designId}/brief`,
        { price_point: "budget" },
        headers
      )
      expect(res.data.brief.concept_theme).toBeNull()
      expect(res.data.brief.design_budget).toBeNull()
      expect(res.data.brief.price_point).toBe("budget")
    })

    it("rejects an invalid price_point", async () => {
      const err = await api
        .post(
          `/admin/designs/${designId}/brief`,
          { price_point: "ultra_premium" },
          headers
        )
        .catch((e) => e)
      expect(err.response.status).toBe(400)
    })

    it("rejects a competitor without a name", async () => {
      const err = await api
        .post(
          `/admin/designs/${designId}/brief`,
          { competitors: [{ differentiator: "no name" }] },
          headers
        )
        .catch((e) => e)
      expect(err.response.status).toBe(400)
    })
  })

  describe("PUT /admin/designs/:id/brief", () => {
    it("partially updates only provided fields", async () => {
      await api.post(
        `/admin/designs/${designId}/brief`,
        { concept_theme: "Original", price_point: "luxury", design_budget: 9000 },
        headers
      )

      const res = await api.put(
        `/admin/designs/${designId}/brief`,
        { price_point: "budget" },
        headers
      )

      expect(res.status).toBe(200)
      // Patched field changed…
      expect(res.data.brief.price_point).toBe("budget")
      // …untouched fields preserved.
      expect(res.data.brief.concept_theme).toBe("Original")
      expect(res.data.brief.design_budget).toBe(9000)
    })
  })
})
