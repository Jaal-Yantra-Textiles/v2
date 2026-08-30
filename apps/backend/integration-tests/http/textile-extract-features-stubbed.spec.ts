/**
 * Integration tests for textile feature extraction APIs with the AI
 * generation process STUBBED.
 *
 * The real Mastra instance boots (as in every other spec) but
 * `mastra.getWorkflow("textileProductExtractionWorkflow")` is monkey-patched
 * to return a fake workflow whose `run.start()` resolves a canned extraction.
 * No OpenRouter / vision-model traffic ever leaves the test process, while the
 * full Medusa long-running workflow machinery (trigger → 202 → confirm →
 * background processing → persistence → folder progress mirroring) is
 * exercised end-to-end over HTTP.
 *
 * Covered:
 * - POST /admin/medias/extract-features           (per-media, stubbed AI)
 * - POST /admin/medias/folder/:id/extract-features (folder-wide, rate-limited, stubbed AI)
 * - POST .../confirm and GET .../status
 * - Validation and error paths (no images, unknown folder, invalid interval)
 * - Per-photo failure isolation inside a folder run
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { mastra } from "../../src/mastra"

jest.setTimeout(120000)

// ============================================
// Stubbed AI generation
// ============================================

/**
 * Pass-1 output of the feedback-oriented pipeline: what is VISIBLE only.
 */
const FAKE_VISUAL_OBSERVATIONS = {
  visible_colors: ["indigo blue", "off-white"],
  visible_pattern: "block-print",
  pattern_description: "Repeating floral block-print motif, medium scale, all-over placement",
  design_elements: ["woven border", "running-stitch embroidery"],
  fabric: {
    type_idea: "cotton-like",
    texture: "matte",
    weave_or_knit: "plain weave",
    perceived_weight: "lightweight & drapey",
    finish: "hand-dyed",
  },
  visible_item: "folded yardage of printed cloth",
  visible_text: [],
  shot_type: "flat lay",
  not_visible_or_uncertain: ["fabric composition not visible", "no care label visible"],
}

/**
 * Pass-2 output: product fields derived from the observations.
 */
const FAKE_EXTRACTION = {
  title: "Indigo Block-Print Cotton Yardage",
  description:
    "Hand-printed cotton yardage in indigo and off-white with a repeating floral block-print and woven border.",
  designer: null,
  model_name: null,
  cloth_type: "fabric",
  pattern: "block-print",
  fabric_weight: "lightweight",
  care_instructions: ["Hand wash cold", "Do not bleach"],
  season: ["spring", "summer"],
  occasion: ["casual"],
  colors: ["indigo blue", "off-white"],
  category: "fabric",
  suggested_price: { amount: 45, currency: "USD" },
  seo_keywords: ["block print", "indigo cotton", "hand printed fabric"],
  target_audience: "textile enthusiasts and boutique owners",
  confidence: 0.92,
  visual_observations: FAKE_VISUAL_OBSERVATIONS,
  face_raw: null,
  body_raw: null,
  model_characteristics: null,
}

const makeFakeRunResult = () => ({
  steps: {
    observeVisibleFeatures: { status: "success", output: FAKE_VISUAL_OBSERVATIONS },
    deriveProductFields: { status: "success", output: FAKE_EXTRACTION },
    validateTextileExtraction: { status: "success", output: FAKE_EXTRACTION },
  },
})

let mockRunStart: any

// Point the Mastra registry's textile workflow at a fake whose run.start()
// is a jest mock. Every other workflow keeps its real implementation.
const realGetWorkflow = (mastra as any).getWorkflow.bind(mastra)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeAll(() => {
    mockRunStart = jest.fn()
    ;(mastra as any).getWorkflow = (id: string) => {
      if (id === "textileProductExtractionWorkflow") {
        return { createRun: () => ({ start: mockRunStart }) }
      }
      return realGetWorkflow(id)
    }
  })

  afterAll(() => {
    ;(mastra as any).getWorkflow = realGetWorkflow
  })

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    mockRunStart.mockReset()
    mockRunStart.mockImplementation(async () => makeFakeRunResult())
  })

  // ============================================
  // Test helpers
  // ============================================

  const unique = () => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`

  const getMediaService = () => (getContainer().resolve("media") as any)

  const seedImageMedia = async (folderId?: string) => {
    const token = unique()
    return getMediaService().createMediaFiles({
      file_name: `${token}.jpg`,
      original_name: `${token}.jpg`,
      file_path: `https://cdn.example.com/${token}.jpg`,
      file_type: "image",
      mime_type: "image/jpeg",
      file_size: 1024,
      file_hash: `hash-${token}`,
      extension: "jpg",
      is_public: true,
      ...(folderId ? { folder_id: folderId } : {}),
    })
  }

  const seedFolderWithImages = async (imageCount: number) => {
    const mediaService = getMediaService()
    const token = unique()
    const folder = await mediaService.createFolders({
      name: `Extraction Test ${token}`,
      slug: `extraction-test-${token}`,
      path: `/extraction-test-${token}`,
      level: 0,
      sort_order: 0,
      is_public: true,
    })
    const images: any[] = []
    for (let i = 0; i < imageCount; i++) {
      images.push(await seedImageMedia(folder.id))
    }
    return { folder, images }
  }

  const waitFor = async (
    check: () => Promise<boolean>,
    timeoutMs = 45000,
    intervalMs = 500
  ) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        if (await check()) return true
      } catch {
        // transient polling errors (e.g. while workflows are mid-flight)
        // must not abort the wait loop
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return false
  }

  const getMediaMetadata = async (mediaId: string) => {
    const mediaService = getMediaService()
    const [fresh] = await mediaService.listMediaFiles({ id: mediaId }, { take: 1 })
    return fresh?.metadata || null
  }

  // ============================================
  // Per-media extraction with stubbed generation
  // ============================================

  describe("POST /admin/medias/extract-features (stubbed generation)", () => {
    it("initiates, confirms, and persists the stubbed extraction with visual_observations", async () => {
      const media = await seedImageMedia()

      // 1) Trigger
      const extractRes = await api.post(
        "/admin/medias/extract-features",
        {
          media_id: media.id,
          hints: ["focus on weave structure"],
          gender: "female",
          persist: true,
        },
        headers
      )

      expect(extractRes.status).toBe(202)
      expect(extractRes.data.transaction_id).toBeDefined()
      expect(extractRes.data.status).toBe("pending_confirmation")

      // The workflow is suspended at the wait step — the stub must NOT
      // have been called yet.
      expect(mockRunStart).not.toHaveBeenCalled()

      // 2) Confirm to start background processing
      const confirmRes = await api.post(
        `/admin/medias/extract-features/${extractRes.data.transaction_id}/confirm`,
        {},
        headers
      )
      expect(confirmRes.status).toBe(200)
      expect(confirmRes.data.success).toBe(true)

      // 3) Wait for background persistence of the stubbed result
      const persisted = await waitFor(async () => {
        const metadata = await getMediaMetadata(media.id)
        return !!metadata?.textile_extraction
      })
      expect(persisted).toBe(true)

      // 4) The stub received the right inputs
      expect(mockRunStart).toHaveBeenCalledTimes(1)
      const stubInput = mockRunStart.mock.calls[0][0]?.inputData
      expect(stubInput.image_url).toBe(media.file_path)
      expect(stubInput.hints).toContain("focus on weave structure")
      expect(stubInput.gender).toBe("female")

      const metadata = await getMediaMetadata(media.id)
      const extraction = metadata.textile_extraction

      // Product fields derived by pass 2 (stubbed)
      expect(extraction.title).toBe(FAKE_EXTRACTION.title)
      expect(extraction.pattern).toBe("block-print")
      expect(extraction.colors).toEqual(["indigo blue", "off-white"])

      // Feedback trail: what was visible is preserved end-to-end
      expect(extraction.visual_observations).toBeDefined()
      expect(extraction.visual_observations.visible_pattern).toBe("block-print")
      expect(extraction.visual_observations.fabric.type_idea).toBe("cotton-like")
      expect(extraction.visual_observations.not_visible_or_uncertain).toContain(
        "fabric composition not visible"
      )
      expect(metadata.extracted_at).toBeDefined()
    })
  })

  // ============================================
  // Folder-wide extraction with stubbed generation
  // ============================================

  describe("POST /admin/medias/folder/:id/extract-features (stubbed generation)", () => {
    it("extracts every image in the folder sequentially at the configured rate and reports progress", async () => {
      const { folder, images } = await seedFolderWithImages(2)

      // 1) Trigger folder-wide extraction — 5s between photos for test speed
      const extractRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features`,
        {
          persist: true,
          interval_ms: 5000,
          gender: "female",
        },
        headers
      )

      expect(extractRes.status).toBe(202)
      expect(extractRes.data.transaction_id).toBeDefined()
      expect(extractRes.data.folder_id).toBe(folder.id)
      expect(extractRes.data.total_images).toBe(2)
      expect(extractRes.data.status).toBe("pending_confirmation")

      // 2) Status before confirmation: nothing has run yet
      const statusBefore = await api.get(
        `/admin/medias/folder/${folder.id}/extract-features/status`,
        headers
      )
      expect(statusBefore.status).toBe(200)
      expect(statusBefore.data.has_run).toBe(false)
      expect(statusBefore.data.progress).toBeNull()

      // 3) Confirm to start the rate-limited background run
      const confirmRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/${extractRes.data.transaction_id}/confirm`,
        {},
        headers
      )
      expect(confirmRes.status).toBe(200)
      expect(confirmRes.data.success).toBe(true)

      // 4) Poll the status endpoint until the run completes
      const done = await waitFor(async () => {
        const statusRes = await api.get(
          `/admin/medias/folder/${folder.id}/extract-features/status`,
          headers
        )
        return (
          statusRes.status === 200 &&
          statusRes.data.progress?.status === "completed"
        )
      })
      expect(done).toBe(true)

      const statusRes = await api.get(
        `/admin/medias/folder/${folder.id}/extract-features/status`,
        headers
      )
      const progress = statusRes.data.progress
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(2)
      expect(progress.failed).toBe(0)
      expect(progress.interval_ms).toBe(5000)
      expect(progress.started_at).toBeDefined()
      expect(progress.finished_at).toBeDefined()

      // 5) The stub processed each photo with its own image URL
      expect(mockRunStart).toHaveBeenCalledTimes(2)
      const calledUrls = mockRunStart.mock.calls.map(
        (c: any[]) => c[0]?.inputData?.image_url
      )
      for (const image of images) {
        expect(calledUrls).toContain(image.file_path)
      }
      expect(mockRunStart.mock.calls[0][0]?.inputData.gender).toBe("female")

      // 6) Both media persisted the stubbed extraction
      for (const image of images) {
        const metadata = await getMediaMetadata(image.id)
        expect(metadata?.textile_extraction?.title).toBe(FAKE_EXTRACTION.title)
        expect(metadata?.textile_extraction?.visual_observations.visible_colors).toEqual([
          "indigo blue",
          "off-white",
        ])
      }
    })

    it("records per-photo failures without aborting the folder run", async () => {
      const { folder, images } = await seedFolderWithImages(2)

      // First photo's generation fails; second succeeds (list is ordered
      // by created_at ASC, so the first-seeded image fails)
      mockRunStart.mockImplementationOnce(async () => {
        throw new Error("AI provider down")
      })

      const extractRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features`,
        {
          persist: true,
          interval_ms: 5000,
        },
        headers
      )
      expect(extractRes.status).toBe(202)
      const transactionId = extractRes.data.transaction_id

      const confirmRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/${transactionId}/confirm`,
        {},
        headers
      )
      expect(confirmRes.status).toBe(200)

      const done = await waitFor(async () => {
        const statusRes = await api.get(
          `/admin/medias/folder/${folder.id}/extract-features/status`,
          headers
        )
        const p = statusRes.data.progress
        return !!p && (p.status === "completed" || p.status === "failed")
      })
      expect(done).toBe(true)

      const statusRes = await api.get(
        `/admin/medias/folder/${folder.id}/extract-features/status`,
        headers
      )
      const progress = statusRes.data.progress

      // One failure did not abort the run — the second photo still completed
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(1)
      expect(progress.failed).toBe(1)
      expect(progress.status).toBe("completed")
      expect(progress.errors).toHaveLength(1)
      expect(progress.errors[0].error).toContain("AI provider down")
      expect([images[0].id, images[1].id]).toContain(progress.errors[0].media_id)

      // Failed photo has no extraction; the other one does
      const failedId = progress.errors[0].media_id
      const okImage = images.find((i) => i.id !== failedId)
      const failedMetadata = await getMediaMetadata(failedId)
      expect(failedMetadata?.textile_extraction).toBeUndefined()

      const okMetadata = await getMediaMetadata(okImage!.id)
      expect(okMetadata?.textile_extraction?.title).toBe(FAKE_EXTRACTION.title)
    })

    it("returns 400 when the folder has no image files", async () => {
      const { folder } = await seedFolderWithImages(0)

      try {
        await api.post(
          `/admin/medias/folder/${folder.id}/extract-features`,
          { persist: true },
          headers
        )
        fail("Should have rejected a folder with no images")
      } catch (error: any) {
        expect(error.response?.status).toBe(400)
        expect(error.response?.data?.message).toContain("no image files")
      }
    })

    it("returns 404 for a non-existent folder", async () => {
      try {
        await api.post(
          "/admin/medias/folder/does-not-exist/extract-features",
          { persist: true },
          headers
        )
        fail("Should have rejected a non-existent folder")
      } catch (error: any) {
        expect(error.response?.status).toBe(404)
      }
    })

    it("rejects invalid interval_ms values", async () => {
      const { folder } = await seedFolderWithImages(1)

      try {
        await api.post(
          `/admin/medias/folder/${folder.id}/extract-features`,
          { interval_ms: 0 },
          headers
        )
        fail("Should have rejected interval_ms <= 0")
      } catch (error: any) {
        expect([400, 422]).toContain(error.response?.status)
      }
    })

    it("reports has_run=false for a folder that never ran", async () => {
      const { folder } = await seedFolderWithImages(0)

      const statusRes = await api.get(
        `/admin/medias/folder/${folder.id}/extract-features/status`,
        headers
      )
      expect(statusRes.status).toBe(200)
      expect(statusRes.data.folder_id).toBe(folder.id)
      expect(statusRes.data.has_run).toBe(false)
      expect(statusRes.data.progress).toBeNull()
    })
  })
})
