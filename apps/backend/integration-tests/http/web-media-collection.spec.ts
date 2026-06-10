import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

// GET /web/media?album_id=… resolves the id as an Album first, then as a
// public media FOLDER. The folder fallback is what feeds the storefront
// hero paintings (folder `media_art_hero`) — roadmap bug #22 was this id
// silently matching nothing and the hero degrading to the random pool.
setupSharedTestSuite(() => {
  describe("GET /web/media collection scoping", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: any

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("returns a public folder's public images when album_id is a folder id", async () => {
      const unique = Date.now()

      const folderRes = await api.post(
        "/admin/medias/folder",
        { name: `Hero Paintings ${unique}`, is_public: true },
        adminHeaders
      )
      expect(folderRes.status).toBe(201)
      const folderId = folderRes.data.folder.id

      const mediaService: any = getContainer().resolve("media")
      const mk = (n: number, pub: boolean) =>
        mediaService.createMediaFiles({
          file_name: `painting-${unique}-${n}.jpg`,
          original_name: `painting-${unique}-${n}.jpg`,
          file_path: `https://cdn.example.com/painting-${unique}-${n}.jpg`,
          file_type: "image",
          mime_type: "image/jpeg",
          file_size: 1000,
          file_hash: `hash-${unique}-${n}`,
          extension: "jpg",
          is_public: pub,
          folder_id: folderId,
        })
      await mk(1, true)
      await mk(2, true)
      await mk(3, false) // private — must not leak

      const res = await api.get(
        `/web/media?album_id=${folderId}&type=image&random=false&limit=50`
      )
      expect(res.status).toBe(200)
      const paths = (res.data.medias || []).map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/painting-${unique}-1.jpg`)
      expect(paths).toContain(`https://cdn.example.com/painting-${unique}-2.jpg`)
      expect(paths).not.toContain(`https://cdn.example.com/painting-${unique}-3.jpg`)
      expect(res.data.medias.length).toBe(2)
    })

    it("returns empty (not the global pool) for an unknown collection id", async () => {
      const res = await api.get(
        `/web/media?album_id=01HUNKNOWNCOLLECTION00000&type=image&random=false&limit=50`
      )
      expect(res.status).toBe(200)
      expect(res.data.medias).toEqual([])
    })
  })
})
