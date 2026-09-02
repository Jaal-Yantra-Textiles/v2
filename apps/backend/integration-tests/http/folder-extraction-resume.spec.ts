/**
 * #1742 — a folder extraction that a deploy killed mid-loop must be resumable,
 * and must be VISIBLY stopped rather than claiming to run forever.
 *
 * ## The production case these tests reproduce
 *
 * Folder `01KZTFAA2TFN5RXFVDMD2RAWZG` (62 images) stopped at 18 completed / 1
 * failed when the 02:29→03:06 deploy replaced the ECS task holding the loop.
 * Five hours later the admin still showed a spinning blue "running" bar, the
 * workflow execution still said `invoking`, and the only route that could
 * restart anything — "retry failed" — offered to re-run **1** file, because the
 * 43 it never reached are not errors.
 *
 * Every case below is written against that shape: a folder with some analysed
 * images, one recorded failure, and a pile that was never touched.
 *
 * The AI generation is stubbed exactly as `textile-extract-features-stubbed`
 * does it — the real Medusa long-running machinery runs, no vision traffic
 * leaves the process.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { mastra } from "../../src/mastra"
import { persistTextileAnalysis } from "../../src/modules/textile-analysis/lib/persist"

jest.setTimeout(120000)

const FAKE_VISUAL_OBSERVATIONS = {
  visible_colors: ["indigo blue"],
  visible_pattern: "block-print",
  pattern_description: "Repeating floral block-print motif",
  design_elements: ["woven border"],
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
  not_visible_or_uncertain: [],
}

const FAKE_EXTRACTION = {
  title: "Indigo Block-Print Cotton Yardage",
  description: "Hand-printed cotton yardage in indigo with a repeating floral block-print.",
  designer: null,
  model_name: null,
  cloth_type: "fabric",
  pattern: "block-print",
  fabric_weight: "lightweight",
  care_instructions: ["Hand wash cold"],
  season: ["summer"],
  occasion: ["casual"],
  colors: ["indigo blue"],
  category: "fabric",
  suggested_price: { amount: 1200, currency: "INR" },
  seo_keywords: ["indigo", "block print"],
  target_audience: "women",
  confidence: 0.9,
}

const makeFakeRunResult = () => ({
  steps: {
    observeVisibleFeatures: { status: "success", output: FAKE_VISUAL_OBSERVATIONS },
    deriveProductFields: { status: "success", output: FAKE_EXTRACTION },
    validateTextileExtraction: { status: "success", output: FAKE_EXTRACTION },
  },
})

let mockRunStart: jest.Mock
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

  const unique = () => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const getMediaService = () => getContainer().resolve("media") as any

  const seedFolderWithImages = async (imageCount: number) => {
    const mediaService = getMediaService()
    const token = unique()
    const folder = await mediaService.createFolders({
      name: `Resume Test ${token}`,
      slug: `resume-test-${token}`,
      path: `/resume-test-${token}`,
      level: 0,
      sort_order: 0,
      is_public: true,
    })

    const images: any[] = []
    for (let i = 0; i < imageCount; i++) {
      const t = unique()
      images.push(
        await mediaService.createMediaFiles({
          file_name: `${t}.jpg`,
          original_name: `${t}.jpg`,
          file_path: `https://cdn.example.com/${t}.jpg`,
          file_type: "image",
          mime_type: "image/jpeg",
          file_size: 1024,
          file_hash: `hash-${t}`,
          extension: "jpg",
          is_public: true,
          folder_id: folder.id,
        })
      )
    }
    return { folder, images }
  }

  /**
   * Mark an image analysed the way the workflow does — the real writer, so the
   * link row and its table name are the real ones.
   *
   * ⚠️ Deliberately NOT the extraction route. A seed helper that performs the
   * thing under test asserts nothing: the resume would pass before the resume
   * code ran.
   */
  const markAnalysed = async (mediaId: string) => {
    await persistTextileAnalysis(getContainer(), {
      media_id: mediaId,
      payload: FAKE_EXTRACTION,
      source: "internal_extraction",
    })
  }

  /**
   * Write the progress a killed run leaves behind: still "running", last
   * touched `silentMinutes` ago, with whatever it managed to record.
   */
  const writeStalledProgress = async (
    folder: any,
    opts: { total: number; completed: number; failedMediaId?: string; silentMinutes: number }
  ) => {
    const mediaService = getMediaService()
    const updatedAt = new Date(Date.now() - opts.silentMinutes * 60_000).toISOString()

    await mediaService.updateFolders({
      selector: { id: folder.id },
      data: {
        metadata: {
          ...(folder.metadata || {}),
          folder_extraction: {
            status: "running",
            total: opts.total,
            completed: opts.completed,
            failed: opts.failedMediaId ? 1 : 0,
            interval_ms: 5000,
            started_at: new Date(Date.now() - (opts.silentMinutes + 60) * 60_000).toISOString(),
            updated_at: updatedAt,
            finished_at: null,
            last_media_id: null,
            errors: opts.failedMediaId
              ? [
                  {
                    media_id: opts.failedMediaId,
                    error:
                      "Textile extraction failed at step deriveProductFields: expected string, received array",
                  },
                ]
              : [],
          },
        },
      },
    })
  }

  const waitFor = async (check: () => Promise<boolean>, timeoutMs = 60000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        if (await check()) return true
      } catch {
        // transient polling errors must not abort the wait
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  const getStatus = async (folderId: string) =>
    (await api.get(`/admin/medias/folder/${folderId}/extract-features/status`, headers)).data

  // ============================================
  // Knowing it stopped
  // ============================================

  describe("GET .../extract-features/status", () => {
    /**
     * 🔴 The whole reason the production folder sat unnoticed for five hours.
     * `status` is written by the process, and a process that dies writes
     * nothing — least of all "I died".
     */
    it("calls a run that has written no progress in hours stalled, though its status still says running", async () => {
      const { folder, images } = await seedFolderWithImages(4)
      await markAnalysed(images[0].id)
      await writeStalledProgress(folder, {
        total: 4,
        completed: 1,
        failedMediaId: images[1].id,
        silentMinutes: 300,
      })

      const status = await getStatus(folder.id)

      expect(status.progress.status).toBe("running")
      expect(status.stalled).toBe(true)
      expect(status.silent_for_ms).toBeGreaterThan(status.stall_threshold_ms)
      expect(status.resumable).toBe(true)
    })

    it("leaves a run that wrote progress moments ago alone", async () => {
      const { folder, images } = await seedFolderWithImages(2)
      await markAnalysed(images[0].id)
      await writeStalledProgress(folder, { total: 2, completed: 1, silentMinutes: 0 })

      const status = await getStatus(folder.id)

      expect(status.progress.status).toBe("running")
      expect(status.stalled).toBe(false)
      expect(status.resumable).toBe(false)
    })

    /**
     * 🔑 The count that matters is "images with no analysis", and it comes from
     * the same derivation the resume uses — so the number on screen and the
     * number actually processed cannot disagree.
     */
    it("reports the outstanding count, counting the failed and the never-attempted alike", async () => {
      const { folder, images } = await seedFolderWithImages(5)
      await markAnalysed(images[0].id)
      await markAnalysed(images[1].id)
      await writeStalledProgress(folder, {
        total: 5,
        completed: 2,
        failedMediaId: images[2].id,
        silentMinutes: 300,
      })

      const status = await getStatus(folder.id)

      expect(status.folder_total).toBe(5)
      // 1 failed + 2 never attempted — NOT the 1 in `errors`.
      expect(status.pending_count).toBe(3)
    })
  })

  // ============================================
  // Resuming it
  // ============================================

  describe("POST .../extract-features/retry (resume)", () => {
    /**
     * 🔴 THE defect. The old route read `folder_extraction.errors` and would
     * have answered `retried: 1` here, leaving two images no route could ever
     * reach.
     */
    it("resumes every outstanding image, not just the one recorded as failed", async () => {
      const { folder, images } = await seedFolderWithImages(4)
      await markAnalysed(images[0].id)
      await writeStalledProgress(folder, {
        total: 4,
        completed: 1,
        failedMediaId: images[1].id,
        silentMinutes: 300,
      })

      const res = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/retry`,
        {},
        headers
      )

      expect(res.status).toBe(202)
      expect(res.data.folder_total).toBe(4)
      // 1 failed + 2 never attempted. The old route said 1.
      expect(res.data.resumed).toBe(3)

      const finished = await waitFor(async () => {
        const status = await getStatus(folder.id)
        return status.progress?.status === "completed"
      })
      expect(finished).toBe(true)

      const status = await getStatus(folder.id)
      expect(status.pending_count).toBe(0)
      expect(status.resumable).toBe(false)
    })

    /**
     * ⚠️ The already-analysed image must not be extracted a second time.
     * `link.create` is not idempotent, so a re-do leaves a duplicate analysis
     * row for every image — and bills a vision call for each.
     */
    it("does not re-extract images that already have an analysis", async () => {
      const { folder, images } = await seedFolderWithImages(3)
      await markAnalysed(images[0].id)
      await markAnalysed(images[1].id)
      await writeStalledProgress(folder, { total: 3, completed: 2, silentMinutes: 300 })

      mockRunStart.mockClear()

      const res = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/retry`,
        {},
        headers
      )
      expect(res.data.resumed).toBe(1)

      const finished = await waitFor(async () => {
        const status = await getStatus(folder.id)
        return status.progress?.status === "completed"
      })
      expect(finished).toBe(true)

      // Exactly one image was sent to the model — the one that had no analysis.
      expect(mockRunStart).toHaveBeenCalledTimes(1)
    })

    it("answers 'nothing to resume' when every image is already analysed", async () => {
      const { folder, images } = await seedFolderWithImages(2)
      await markAnalysed(images[0].id)
      await markAnalysed(images[1].id)
      await writeStalledProgress(folder, { total: 2, completed: 2, silentMinutes: 300 })

      const res = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/retry`,
        {},
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.resumed).toBe(0)
      expect(res.data.pending_count).toBe(0)
    })

    /**
     * 🔴 Two loops over one folder would extract every pending image twice, in
     * parallel, at double the provider rate the pacing exists to respect.
     */
    it("refuses to start a second run while one is genuinely still alive", async () => {
      const { folder, images } = await seedFolderWithImages(3)
      await markAnalysed(images[0].id)
      await writeStalledProgress(folder, { total: 3, completed: 1, silentMinutes: 0 })

      const res = await api
        .post(`/admin/medias/folder/${folder.id}/extract-features/retry`, {}, headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(String(res.data.message)).toMatch(/still running/i)
    })
  })

  // ============================================
  // Asking for the remainder directly
  // ============================================

  describe("POST .../extract-features with scope", () => {
    /**
     * 🔴 `media_ids` had been an input on the workflow since it was written,
     * but no schema declared it and the route never destructured it — so the
     * only thing the API could ask for was "all of them". A field the caller
     * cannot send is a capability that does not exist.
     */
    it("scope=pending extracts only the images with no analysis yet", async () => {
      const { folder, images } = await seedFolderWithImages(3)
      await markAnalysed(images[0].id)

      mockRunStart.mockClear()

      const extractRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features`,
        { persist: true, interval_ms: 5000, scope: "pending" },
        headers
      )
      expect(extractRes.status).toBe(202)

      await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/${extractRes.data.transaction_id}/confirm`,
        {},
        headers
      )

      const finished = await waitFor(async () => {
        const status = await getStatus(folder.id)
        return status.progress?.status === "completed"
      })
      expect(finished).toBe(true)

      const status = await getStatus(folder.id)
      expect(status.progress.total).toBe(2)
      expect(status.progress.scope).toBe("pending")
      expect(status.progress.folder_total).toBe(3)
      expect(status.progress.already_done).toBe(1)
      expect(mockRunStart).toHaveBeenCalledTimes(2)
    })

    it("accepts an explicit media_ids list", async () => {
      const { folder, images } = await seedFolderWithImages(3)

      mockRunStart.mockClear()

      const extractRes = await api.post(
        `/admin/medias/folder/${folder.id}/extract-features`,
        { persist: true, interval_ms: 5000, media_ids: [images[2].id] },
        headers
      )
      expect(extractRes.status).toBe(202)

      await api.post(
        `/admin/medias/folder/${folder.id}/extract-features/${extractRes.data.transaction_id}/confirm`,
        {},
        headers
      )

      const finished = await waitFor(async () => {
        const status = await getStatus(folder.id)
        return status.progress?.status === "completed"
      })
      expect(finished).toBe(true)

      expect((await getStatus(folder.id)).progress.total).toBe(1)
      expect(mockRunStart).toHaveBeenCalledTimes(1)
    })

    it("400s a scope=pending run on a folder that has nothing left", async () => {
      const { folder, images } = await seedFolderWithImages(1)
      await markAnalysed(images[0].id)

      const res = await api
        .post(
          `/admin/medias/folder/${folder.id}/extract-features`,
          { persist: true, interval_ms: 5000, scope: "pending" },
          headers
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      expect(String(res.data.message)).toMatch(/already has a textile analysis/i)
    })
  })
})
