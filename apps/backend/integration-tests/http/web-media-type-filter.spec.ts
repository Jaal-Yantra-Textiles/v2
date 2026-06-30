import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

// GET /web/media?type=… must filter by the MediaFile `file_type` column.
// The route used to set `filters.type`, but listAllMediasWorkflow's
// field whitelist only allows `file_type` — so `type` was silently
// dropped and the endpoint leaked every public media regardless of the
// requested type (e.g. `type=video` returned images). This is the
// non-album path (listAllMediasWorkflow); the album/folder paths
// already filtered on `file_type` correctly.
setupSharedTestSuite(() => {
  describe("GET /web/media type filter", () => {
    const { api, getContainer } = getSharedTestEnv()

    it("returns only videos when type=video (no album_id)", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed a public image and a public video into the global pool
      // (no folder/album) so the request hits listAllMediasWorkflow.
      await mediaService.createMediaFiles({
        file_name: `leak-img-${unique}.jpg`,
        original_name: `leak-img-${unique}.jpg`,
        file_path: `https://cdn.example.com/leak-img-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-img-${unique}`,
        extension: "jpg",
        is_public: true,
      })
      await mediaService.createMediaFiles({
        file_name: `leak-vid-${unique}.mp4`,
        original_name: `leak-vid-${unique}.mp4`,
        file_path: `https://cdn.example.com/leak-vid-${unique}.mp4`,
        file_type: "video",
        mime_type: "video/mp4",
        file_size: 5000,
        file_hash: `hash-vid-${unique}`,
        extension: "mp4",
        is_public: true,
      })

      const res = await api.get(
        `/web/media?type=video&random=false&limit=100`
      )
      expect(res.status).toBe(200)
      const medias = res.data.medias || []

      // Every returned media must be a video — if the filter is broken,
      // the seeded image (and any other public images) leak through.
      for (const m of medias) {
        expect(m.type).toBe("video")
      }

      // The seeded video should be present, and the seeded image must not.
      const paths = medias.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/leak-vid-${unique}.mp4`)
      expect(paths).not.toContain(`https://cdn.example.com/leak-img-${unique}.jpg`)
    })

    it("returns only images when type=image (no album_id)", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      await mediaService.createMediaFiles({
        file_name: `leak-img2-${unique}.jpg`,
        original_name: `leak-img2-${unique}.jpg`,
        file_path: `https://cdn.example.com/leak-img2-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-img2-${unique}`,
        extension: "jpg",
        is_public: true,
      })
      await mediaService.createMediaFiles({
        file_name: `leak-vid2-${unique}.mp4`,
        original_name: `leak-vid2-${unique}.mp4`,
        file_path: `https://cdn.example.com/leak-vid2-${unique}.mp4`,
        file_type: "video",
        mime_type: "video/mp4",
        file_size: 5000,
        file_hash: `hash-vid2-${unique}`,
        extension: "mp4",
        is_public: true,
      })

      const res = await api.get(
        `/web/media?type=image&random=false&limit=100`
      )
      expect(res.status).toBe(200)
      const medias = res.data.medias || []

      for (const m of medias) {
        expect(m.type).toBe("image")
      }

      const paths = medias.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/leak-img2-${unique}.jpg`)
      expect(paths).not.toContain(`https://cdn.example.com/leak-vid2-${unique}.mp4`)
    })
  })
})
