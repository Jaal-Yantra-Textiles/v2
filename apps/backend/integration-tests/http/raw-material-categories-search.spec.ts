import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

// Roadmap bug #1 follow-up — the /admin/categories/rawmaterials list
// endpoint now supports partial, case-insensitive search via `q`
// (previously the `name` filter did an exact match, so partial searches
// returned nothing). `q` is the canonical Medusa search param and maps
// to an ilike $or across name + description.
setupSharedTestSuite(() => {
  describe("Admin raw-material categories — search", () => {
    let adminHeaders: { headers: Record<string, string> }
    const tag = `${Date.now()}`
    const lower = `pwcotton-${tag}`
    const upper = `PWCotton-${tag}`
    const other = `pwsilk-${tag}`

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      for (const name of [lower, upper, other]) {
        await api.post("/admin/categories/rawmaterials", { name }, adminHeaders)
      }
    })

    it("matches a partial term, case-insensitively, across categories", async () => {
      const { api } = getSharedTestEnv()
      // lowercase query must still match the mixed-case "PWCotton" row
      const res = await api.get(
        `/admin/categories/rawmaterials?q=pwcotton-${tag}&limit=100`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      const names = res.data.categories.map((c: any) => c.name)
      expect(names).toEqual(expect.arrayContaining([lower, upper]))
      // a different category must not leak into a name-specific search
      expect(names).not.toContain(other)
    })

    it("returns nothing for a non-matching term", async () => {
      const { api } = getSharedTestEnv()
      const res = await api.get(
        `/admin/categories/rawmaterials?q=zzzznope-${tag}`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.categories.length).toBe(0)
    })
  })
})
