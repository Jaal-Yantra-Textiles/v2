import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

/**
 * #892 — closes the live-verification gap for POST /admin/designs/:id/moodboard/generate.
 *
 * The scene builder + mapper are unit-tested in isolation; this drives the whole path
 * against a real DB: seed a design (header/flats/size-set/colorways) with Construction
 * specs carrying { technique, params, fabricRules } on their metadata → POST the route →
 * assert the returned Excalidraw scene AND that it persisted to design.moodboard.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any
  let designId: string

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const designService: any = container.resolve(DESIGN_MODULE)

    // Header hints + garment + flats(front fallback) ride on design fields/metadata.
    const design = await designService.createDesigns({
      name: "Craft Revival Top",
      description: "handloom top with neckline embroidery",
      design_type: "Original",
      status: "Conceptual",
      priority: "High",
      thumbnail_url: "https://cdn.example.com/cr-tp08-front.png",
      color_palette: [
        { name: "Natural / Indigo", hex_code: "#2e3a59", thread_ref: "K-7" },
        { name: "Natural / Madder", hex_code: "#a83232", thread_ref: "K-10" },
      ],
      metadata: {
        style_code: "SS26-CR-TP-08",
        season: "SS26",
        category: "Womenswear / Top",
        capsule: "Craft Revival",
        garment_type: "blouse",
        flats: { back_image_url: "https://cdn.example.com/cr-tp08-back.png" },
      },
    })
    designId = design.id

    await designService.createDesignSizeSets({
      design_id: designId,
      size_label: "M",
      measurements: {
        total_length_hps: 66,
        shoulder_across: 38,
        neck_width: 24,
        sleeve_length: 62,
        hem_opening: 160,
      },
    })

    // Three renderable Construction details (each keys a DETAIL_RENDERERS glyph)…
    await designService.createDesignSpecifications([
      {
        design_id: designId,
        title: "Waist dart",
        category: "Construction",
        details: "single-point waist shaping",
        special_instructions: "press toward CF",
        version: "1",
        metadata: {
          technique: "dart",
          params: { intake: 0.6 },
          fabricRules: ["press toward CF", "clip at apex"],
        },
      },
      {
        design_id: designId,
        title: "Hem knife pleats",
        category: "Construction",
        details: "5 knife pleats at hem",
        version: "1",
        metadata: {
          technique: "knife-pleat",
          params: { count: 5 },
          fabricRules: ["press all one direction"],
        },
      },
      {
        design_id: designId,
        title: "Sleeve-head gathers",
        category: "Construction",
        details: "1.6x ease onto armhole",
        version: "1",
        metadata: { technique: "gathers", params: { ratio: 1.6 } },
      },
      // …a Construction spec with NO technique — must be skipped, not rendered anon.
      {
        design_id: designId,
        title: "General assembly note",
        category: "Construction",
        details: "serge all raw edges",
        version: "1",
        metadata: { foo: "bar" },
      },
      // …and a non-Construction spec — must be filtered out entirely.
      {
        design_id: designId,
        title: "Shell fabric",
        category: "Materials",
        details: "100% handloom cotton",
        version: "1",
        metadata: { technique: "dart" }, // technique here must NOT leak in
      },
    ])
  })

  describe("POST /admin/designs/:id/moodboard/generate", () => {
    it("builds a tech-pack scene from the design and persists it to design.moodboard", async () => {
      const res = await api.post(
        `/admin/designs/${designId}/moodboard/generate`,
        {},
        headers
      )

      expect(res.status).toBe(200)
      const scene = res.data.moodboard
      expect(scene).toBeTruthy()
      expect(scene.type).toBe("excalidraw")
      expect(scene.version).toBe(2)

      // Page-frames built from real design data. "3 · Zoom details" is intentionally
      // absent: it needs region bboxes, which the mapper does not derive from any
      // design field yet — so a design produces 4 frames (header/measurements/
      // construction/colorways), not the fixture's 5.
      const frames = scene.elements.filter((e: any) => e.type === "frame")
      expect(frames.map((f: any) => f.name)).toEqual([
        "1 · Header & Flats",
        "2 · Measurements",
        "4 · Construction details",
        "5 · Colorways",
      ])

      // Exactly the three techniqued Construction specs became detail anchors,
      // in source order; the no-technique + non-Construction specs are gone.
      const detailAnchors = scene.elements.filter(
        (e: any) => e.customData?.kind === "construction-detail"
      )
      expect(detailAnchors.map((e: any) => e.customData.technique)).toEqual([
        "dart",
        "knife-pleat",
        "gathers",
      ])

      // Fabric-derived params + sewing rules survive the mapper → customData.
      const dart = detailAnchors.find(
        (e: any) => e.customData.technique === "dart"
      )
      expect(dart.customData.params).toEqual({ intake: 0.6 })
      expect(dart.customData.fabricRules).toContain("clip at apex")

      // Each known technique renders as native editable line glyphs (never raster).
      const glyphs = scene.elements.filter(
        (e: any) =>
          e.type === "line" && e.customData?.kind === "construction-glyph"
      )
      expect(glyphs.length).toBeGreaterThanOrEqual(3)
    })

    it("persists the same scene onto the design (round-trips through the DB)", async () => {
      const gen = await api.post(
        `/admin/designs/${designId}/moodboard/generate`,
        {},
        headers
      )
      const generated = gen.data.moodboard

      const designService: any = getContainer().resolve(DESIGN_MODULE)
      const fetched = await designService.retrieveDesign(designId)

      expect(fetched.moodboard).toBeTruthy()
      expect(fetched.moodboard.type).toBe("excalidraw")
      const persistedFrames = fetched.moodboard.elements.filter(
        (e: any) => e.type === "frame"
      )
      expect(persistedFrames).toHaveLength(4)
      // deterministic builder → persisted scene equals the returned one.
      expect(fetched.moodboard.elements.length).toBe(generated.elements.length)
    })

    it("404s for an unknown design", async () => {
      const res = await api
        .post(`/admin/designs/design_does_not_exist/moodboard/generate`, {}, headers)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
