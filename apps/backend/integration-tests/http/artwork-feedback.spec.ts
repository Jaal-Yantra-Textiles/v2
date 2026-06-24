import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { FEEDBACK_MODULE } from "../../src/modules/feedback"

jest.setTimeout(60000)

// #452 — playful artwork-rating on the public post-delivery feedback page.
// GET /web/feedback/:id returns the feedback + a seeded set of curated artwork;
// POST records the 1..5 rating and (optionally) the validated artwork pick into
// the typed `chosen_artwork_id` / `artwork_affinity` columns.
setupSharedTestSuite(() => {
  describe("artwork feedback page (#452)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: any
    const prevEnv = process.env.FEEDBACK_ARTWORK_ALBUM_ID

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    afterAll(() => {
      process.env.FEEDBACK_ARTWORK_ALBUM_ID = prevEnv
    })

    it("offers a seeded artwork set and records a validated pick + rating", async () => {
      const unique = Date.now()
      const service: any = getContainer().resolve(FEEDBACK_MODULE)

      // A curated folder of public artwork = the artwork source.
      const folderRes = await api.post(
        "/admin/medias/folder",
        { name: `Feedback Art ${unique}`, is_public: true },
        adminHeaders
      )
      expect(folderRes.status).toBe(201)
      const folderId = folderRes.data.folder.id
      process.env.FEEDBACK_ARTWORK_ALBUM_ID = folderId

      const mediaService: any = getContainer().resolve("media")
      for (let n = 1; n <= 5; n++) {
        await mediaService.createMediaFiles({
          file_name: `art-${unique}-${n}.jpg`,
          original_name: `art-${unique}-${n}.jpg`,
          file_path: `https://cdn.example.com/art-${unique}-${n}.jpg`,
          file_type: "image",
          mime_type: "image/jpeg",
          file_size: 1000,
          file_hash: `arthash-${unique}-${n}`,
          extension: "jpg",
          is_public: true,
          folder_id: folderId,
        })
      }

      const feedback = await service.createFeedbacks({
        order_id: `order_${unique}`,
        submitted_by: "c@example.com",
        submitted_at: new Date(),
        status: "pending",
        metadata: { source: "post_delivery_request" },
      })

      // GET — returns the feedback + a deterministic 3-artwork set.
      const getRes = await api.get(`/web/feedback/${feedback.id}`)
      expect(getRes.status).toBe(200)
      expect(getRes.data.feedback.id).toBe(feedback.id)
      const artworks = getRes.data.artworks
      expect(Array.isArray(artworks)).toBe(true)
      expect(artworks).toHaveLength(3)
      expect(new Set(artworks.map((a: any) => a.id)).size).toBe(3)

      // Same seed (same id) → stable set across renders.
      const getRes2 = await api.get(`/web/feedback/${feedback.id}`)
      expect(getRes2.data.artworks.map((a: any) => a.id)).toEqual(
        artworks.map((a: any) => a.id)
      )

      // POST — rating + a valid offered artwork pick.
      const chosen = artworks[1].id
      const postRes = await api.post(`/web/feedback/${feedback.id}`, {
        rating: 5,
        artwork_id: chosen,
        affinity: "calm",
      })
      expect(postRes.status).toBe(200)
      expect(postRes.data.artwork_pick_rejected).toBe(false)
      expect(postRes.data.feedback.rating).toBe("five")
      expect(postRes.data.feedback.chosen_artwork_id).toBe(chosen)
      expect(postRes.data.feedback.artwork_affinity).toBe("calm")

      // Typed columns persisted durably.
      const reloaded = (await service.listFeedbacks({ id: feedback.id }))[0]
      expect(reloaded.chosen_artwork_id).toBe(chosen)
      expect(reloaded.rating).toBe("five")
      expect(reloaded.metadata?.artwork_pick?.artwork_id).toBe(chosen)
      // Pre-existing metadata preserved.
      expect(reloaded.metadata?.source).toBe("post_delivery_request")
    })

    it("rejects an artwork pick that was not offered", async () => {
      const unique = Date.now() + 1
      const service: any = getContainer().resolve(FEEDBACK_MODULE)
      const feedback = await service.createFeedbacks({
        order_id: `order_${unique}`,
        submitted_by: "c2@example.com",
        submitted_at: new Date(),
        status: "pending",
      })

      const res = await api
        .post(`/web/feedback/${feedback.id}`, { artwork_id: "art_not_offered" })
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)

      const reloaded = (await service.listFeedbacks({ id: feedback.id }))[0]
      expect(reloaded.chosen_artwork_id).toBeFalsy()
    })

    it("404s an unknown feedback id", async () => {
      const res = await api
        .get(`/web/feedback/feedback_does_not_exist`)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
