/**
 * #1113 S2 — partner moodboard generate (brief-as-cards).
 *
 * End-to-end: admin sets a design brief (incl. the new aesthetic_keywords +
 * milestones fields) → mints a designer invite → a stranger accepts (becoming an
 * assigned designer partner) → that partner generates the moodboard and gets the
 * three brief anchor frames back, even though the design has no measurements yet.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  let designId: string

  const { api, getContainer } = getSharedTestEnv()
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  const brief = {
    concept_theme: "90s Tokyo Streetwear",
    aesthetic_keywords: ["utilitarian", "sleek", "nostalgic"],
    persona: { age_range: "25-34", lifestyle: "urban minimalist" },
    competitors: [{ name: "Acme Knits", differentiator: "hand-loomed" }],
    price_point: "mid_market",
    design_budget: 250000,
    cost_currency: "inr",
    milestones: [
      { label: "Initial sketches", date: "2026-08-01" },
      { label: "Production-ready samples", date: null },
    ],
  }

  beforeAll(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  beforeEach(async () => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    const created = await designService.createDesigns({
      name: `Moodboard Brief Design ${uniq()}`,
      description: "brief-as-cards test",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    designId = created.id
  })

  it("persists the new brief fields (aesthetic_keywords + milestones)", async () => {
    const res = await api.post(`/admin/designs/${designId}/brief`, brief, headers)
    expect(res.status).toBe(200)
    expect(res.data.brief.aesthetic_keywords).toEqual([
      "utilitarian",
      "sleek",
      "nostalgic",
    ])
    expect(res.data.brief.milestones).toHaveLength(2)
    expect(res.data.brief.milestones[0]).toEqual({
      label: "Initial sketches",
      date: "2026-08-01",
    })
  })

  it("lets an invited (assigned) designer generate the brief moodboard", async () => {
    // 1. Brand sets the brief + invites a designer.
    await api.post(`/admin/designs/${designId}/brief`, brief, headers)
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { inviter_name: "Studio JYT" },
      headers
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      { name: "Ada Weaver", email: `ada-${uniq()}@example.com`, password: "supersecret123" }
    )
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }

    // 2. The assigned designer generates the moodboard — no measurements needed.
    const gen = await api.post(
      `/partners/designs/${designId}/moodboard/generate`,
      {},
      bearer
    )
    expect(gen.status).toBe(200)

    const frameNames = gen.data.moodboard.elements
      .filter((e: any) => e.type === "frame")
      .map((f: any) => f.name)
    expect(frameNames).toEqual(
      expect.arrayContaining([
        "Brief · Concept & Identity",
        "Brief · Audience & Positioning",
        "Brief · Timeline & Budget",
      ])
    )

    const texts = gen.data.moodboard.elements
      .filter((e: any) => e.type === "text")
      .map((e: any) => e.text)
      .join("\n")
    expect(texts).toContain("90s Tokyo Streetwear")
    expect(texts).toContain("INR 250,000")
    expect(texts).toContain("Initial sketches")
  })

  it("rejects a partner who is neither owner nor assigned", async () => {
    await api.post(`/admin/designs/${designId}/brief`, brief, headers)

    // A designer invited to a DIFFERENT design must not author this one.
    const otherService: any = getContainer().resolve(DESIGN_MODULE)
    const other = await otherService.createDesigns({
      name: `Other Design ${uniq()}`,
      description: "other design",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    const mint = await api.post(
      `/admin/designs/${other.id}/designer-invites`,
      {},
      headers
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      { name: "Other Designer", email: `other-${uniq()}@example.com`, password: "supersecret123" }
    )
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }

    const err = await api
      .post(`/partners/designs/${designId}/moodboard/generate`, {}, bearer)
      .catch((e) => e)
    expect(err.response.status).toBe(400)
  })

  it("400s when there's no brief and no tech-pack substance", async () => {
    // Bare design, no brief set → nothing to generate.
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      {},
      headers
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      { name: "Empty Designer", email: `empty-${uniq()}@example.com`, password: "supersecret123" }
    )
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }

    const err = await api
      .post(`/partners/designs/${designId}/moodboard/generate`, {}, bearer)
      .catch((e) => e)
    expect(err.response.status).toBe(400)
  })

  // #1113 S3 — the invited (assigned) designer authors the canvas: saves the
  // scene through an author-scoped route and round-trips a concept-card edit
  // back to the brief column.
  it("lets an assigned designer save the scene and round-trip a brief edit", async () => {
    await api.post(`/admin/designs/${designId}/brief`, brief, headers)
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { inviter_name: "Studio JYT" },
      headers
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      { name: "Sol Weaver", email: `sol-${uniq()}@example.com`, password: "supersecret123" }
    )
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }

    // Generate → get the concept card, edit its body text, save the scene.
    const gen = await api.post(
      `/partners/designs/${designId}/moodboard/generate`,
      {},
      bearer
    )
    const scene = gen.data.moodboard

    const conceptRect = scene.elements.find(
      (e: any) =>
        e.type === "rectangle" &&
        e.customData?.kind === "brief-field" &&
        e.customData?.field === "concept_theme"
    )
    expect(conceptRect).toBeTruthy()

    // The concept body text sits inside the card, below the heading.
    const conceptBody = scene.elements
      .filter(
        (e: any) =>
          e.type === "text" &&
          e.x >= conceptRect.x - 4 &&
          e.x <= conceptRect.x + conceptRect.width &&
          e.y > conceptRect.y + 30 &&
          e.y < conceptRect.y + conceptRect.height
      )
      .sort((a: any, b: any) => b.y - a.y)[0]
    expect(conceptBody?.text).toContain("90s Tokyo Streetwear")
    conceptBody.text = "Neo-Kyoto Techwear"

    const save = await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: scene },
      bearer
    )
    expect(save.status).toBe(200)

    // The assigned designer can also write the brief column back (author-scoped).
    const briefPut = await api.put(
      `/partners/designs/${designId}/brief`,
      { concept_theme: "Neo-Kyoto Techwear" },
      bearer
    )
    expect(briefPut.status).toBe(200)
    expect(briefPut.data.brief.concept_theme).toBe("Neo-Kyoto Techwear")
    // Untouched structured fields survive the partial update.
    expect(briefPut.data.brief.aesthetic_keywords).toEqual([
      "utilitarian",
      "sleek",
      "nostalgic",
    ])
  })

  it("rejects a non-author saving the moodboard scene", async () => {
    await api.post(`/admin/designs/${designId}/brief`, brief, headers)

    const otherService: any = getContainer().resolve(DESIGN_MODULE)
    const other = await otherService.createDesigns({
      name: `Other Save Design ${uniq()}`,
      description: "other design",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    const mint = await api.post(
      `/admin/designs/${other.id}/designer-invites`,
      {},
      headers
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      { name: "Intruder", email: `intruder-${uniq()}@example.com`, password: "supersecret123" }
    )
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }

    const err = await api
      .put(
        `/partners/designs/${designId}/moodboard`,
        { moodboard: { type: "excalidraw", elements: [] } },
        bearer
      )
      .catch((e) => e)
    expect(err.response.status).toBe(400)
  })
})
