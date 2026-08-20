import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * Attach-media from the messaging inbox — the admin action that appends a
 * WhatsApp media URL to a run (metadata + activity note) and mirrors it onto
 * the linked design's gallery. Pins the single-workflow behaviour end-to-end:
 * run write, design mirror (de-duplicated), and the guards.
 */
setupSharedTestSuite(() => {
  describe("Production run — attach media (messaging inbox)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    async function createDesign(unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Attach Media Design ${unique}`,
          description: "x",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    async function createRun(designId: string) {
      const res = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 5 },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.production_run.id
    }

    async function getRun(runId: string) {
      const res = await api.get(`/admin/production-runs/${runId}`, adminHeaders)
      expect(res.status).toBe(200)
      return res.data.production_run
    }

    async function getDesign(designId: string) {
      const res = await api.get(`/admin/designs/${designId}`, adminHeaders)
      expect(res.status).toBe(200)
      return res.data.design
    }

    /** Non-throwing POST so error statuses can be asserted directly. */
    async function post(path: string, body: any) {
      return api.post(path, body, {
        ...adminHeaders,
        validateStatus: () => true,
      })
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("attaches media to the run and mirrors it onto the linked design", async () => {
      const unique = Date.now()
      const designId = await createDesign(unique)
      const runId = await createRun(designId)

      const mediaUrl = `https://cdn.jyt.test/wa/${unique}/sample.jpg`
      const res = await api.post(
        `/admin/production-runs/${runId}/attach-media`,
        {
          media_url: mediaUrl,
          media_mime_type: "image/jpeg",
          filename: "sample.jpg",
          message_id: "msg_123",
          conversation_id: "conv_456",
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.production_run.id).toBe(runId)
      expect(res.data.design).toBeTruthy()
      expect(res.data.design.id).toBe(designId)

      // Run metadata carries the attachment…
      const run = await getRun(runId)
      const attached = run.metadata?.attached_media
      expect(Array.isArray(attached)).toBe(true)
      expect(attached).toHaveLength(1)
      expect(attached[0].url).toBe(mediaUrl)
      expect(attached[0].filename).toBe("sample.jpg")

      // …and the design gallery carries the same URL.
      const design = await getDesign(designId)
      expect(Array.isArray(design.media_files)).toBe(true)
      expect(design.media_files).toHaveLength(1)
      expect(design.media_files[0].url).toBe(mediaUrl)

      // An audit note was written to the timeline.
      const activities = await api.get(
        `/admin/production-runs/${runId}/activities`,
        adminHeaders
      )
      const mediaNotes = activities.data.activities.filter(
        (a: any) => a.kind === "media_attached"
      )
      expect(mediaNotes).toHaveLength(1)
      expect(mediaNotes[0].payload.media_url).toBe(mediaUrl)
    })

    it("de-duplicates the URL on the design across repeated attaches", async () => {
      const unique = Date.now() + 1
      const designId = await createDesign(unique)
      const runId = await createRun(designId)

      const mediaUrl = `https://cdn.jyt.test/wa/${unique}/dup.jpg`
      await api.post(
        `/admin/production-runs/${runId}/attach-media`,
        { media_url: mediaUrl },
        adminHeaders
      )
      await api.post(
        `/admin/production-runs/${runId}/attach-media`,
        { media_url: mediaUrl },
        adminHeaders
      )

      // Run metadata appends once per attach (two entries)…
      const run = await getRun(runId)
      expect(run.metadata.attached_media).toHaveLength(2)

      // …but the design gallery stays de-duplicated (one entry).
      const design = await getDesign(designId)
      expect(design.media_files).toHaveLength(1)
      expect(design.media_files[0].url).toBe(mediaUrl)
    })

    /**
     * #1387 — the lost-update race.
     *
     * `attached_media` lives inside the `metadata` JSON blob, so appending is a
     * read-modify-write of the whole column. The de-duplication test above
     * attaches twice too, but SEQUENTIALLY, so it passes whether or not the
     * write is serialised — sequential is not concurrent, and that is exactly
     * why this went unnoticed.
     *
     * Fired concurrently, both requests read the same array and the second
     * write drops the first. Without the run lock this asserts 3 and gets 1
     * or 2. Realistic: a partner sending photos back to back on WhatsApp.
     */
    it("does not lose attachments when several land concurrently", async () => {
      const unique = Date.now() + 7
      const designId = await createDesign(unique)
      const runId = await createRun(designId)

      const urls = [1, 2, 3].map(
        (n) => `https://cdn.jyt.test/wa/${unique}/race-${n}.jpg`
      )

      const results = await Promise.all(
        urls.map((media_url) =>
          api.post(
            `/admin/production-runs/${runId}/attach-media`,
            { media_url },
            adminHeaders
          )
        )
      )
      for (const res of results) {
        expect(res.status).toBe(200)
      }

      const run = await getRun(runId)
      const attached = run.metadata.attached_media
      expect(attached).toHaveLength(3)
      // Every distinct URL survived — not just the right count.
      expect(attached.map((m: any) => m.url).sort()).toEqual([...urls].sort())
    })

    it("rejects a cancelled run", async () => {
      const unique = Date.now() + 2
      const designId = await createDesign(unique)
      const runId = await createRun(designId)

      const runService: any = getContainer().resolve("production_runs")
      await runService.updateProductionRuns({
        id: runId,
        status: "cancelled",
        cancelled_at: new Date(),
      })

      const res = await post(
        `/admin/production-runs/${runId}/attach-media`,
        { media_url: "https://cdn.jyt.test/wa/cancelled.jpg" }
      )
      expect(res.status).toBe(400)
      expect(String(res.data?.message || "")).toContain("cancelled")
    })

    it("404s a missing run", async () => {
      const res = await post(
        "/admin/production-runs/prun_missing/attach-media",
        { media_url: "https://cdn.jyt.test/wa/missing.jpg" }
      )
      expect(res.status).toBe(404)
    })

    it("rejects a non-URL media_url", async () => {
      const unique = Date.now() + 3
      const designId = await createDesign(unique)
      const runId = await createRun(designId)

      const res = await post(
        `/admin/production-runs/${runId}/attach-media`,
        { media_url: "not-a-url" }
      )
      expect(res.status).toBe(400)
    })
  })
})