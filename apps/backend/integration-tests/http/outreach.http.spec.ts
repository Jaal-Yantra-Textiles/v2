/**
 * #659 slice 4 / PR-4c — marketing-outreach CRM CRUD routes.
 *
 * Exercises the live HTTP surface end-to-end against the shared test DB:
 *   GET    /admin/marketing/outreach        (list + q/status/channel filters + paginate)
 *   POST   /admin/marketing/outreach        (log, with email normalisation)
 *   GET    /admin/marketing/outreach/:id     (retrieve / 404)
 *   POST   /admin/marketing/outreach/:id     (update CRM fields)
 *   DELETE /admin/marketing/outreach/:id     (remove / 404 thereafter)
 *
 * Each test seeds its own rows under a unique campaign so the assertions are
 * insensitive to rows left over from other tests in the shared suite.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeAll(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  describe("POST /admin/marketing/outreach", () => {
    it("creates a row and normalises the email to lower-case", async () => {
      const res = await api.post(
        "/admin/marketing/outreach",
        {
          recipient_email: "  Winback@Example.COM ",
          recipient_name: "Win Back",
          company: "Acme",
          campaign: `create-${Date.now()}`,
        },
        headers
      )

      expect(res.status).toBe(201)
      expect(res.data.outreach.recipient_email).toBe("winback@example.com")
      expect(res.data.outreach.status).toBe("queued")
      expect(res.data.outreach.channel).toBe("email")
      expect(res.data.outreach.id).toBeTruthy()
    })

    it("400s when recipient_email is missing", async () => {
      await expect(
        api.post("/admin/marketing/outreach", { company: "NoEmail" }, headers)
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })

  describe("GET /admin/marketing/outreach", () => {
    it("filters by campaign + status and returns the matched total as count", async () => {
      const campaign = `list-${Date.now()}`
      await api.post(
        "/admin/marketing/outreach",
        { recipient_email: "a@example.com", campaign, status: "sent" },
        headers
      )
      await api.post(
        "/admin/marketing/outreach",
        { recipient_email: "b@example.com", campaign, status: "queued" },
        headers
      )

      const res = await api.get(
        `/admin/marketing/outreach?campaign=${campaign}`,
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(2)
      expect(res.data.outreach).toHaveLength(2)

      const sent = await api.get(
        `/admin/marketing/outreach?campaign=${campaign}&status=sent`,
        headers
      )
      expect(sent.data.count).toBe(1)
      expect(sent.data.outreach[0].status).toBe("sent")
    })

    it("honours q free-text search across recipient/company", async () => {
      const campaign = `q-${Date.now()}`
      await api.post(
        "/admin/marketing/outreach",
        { recipient_email: "needle@example.com", company: "Findme Co", campaign },
        headers
      )
      await api.post(
        "/admin/marketing/outreach",
        { recipient_email: "other@example.com", company: "Nope", campaign },
        headers
      )

      const res = await api.get(
        `/admin/marketing/outreach?campaign=${campaign}&q=findme`,
        headers
      )
      expect(res.data.count).toBe(1)
      expect(res.data.outreach[0].recipient_email).toBe("needle@example.com")
    })

    it("paginates with count = total matched (not the page size)", async () => {
      const campaign = `page-${Date.now()}`
      for (let i = 0; i < 3; i++) {
        await api.post(
          "/admin/marketing/outreach",
          { recipient_email: `p${i}@example.com`, campaign },
          headers
        )
      }
      const res = await api.get(
        `/admin/marketing/outreach?campaign=${campaign}&limit=2&offset=0`,
        headers
      )
      expect(res.data.count).toBe(3)
      expect(res.data.outreach).toHaveLength(2)
      expect(res.data.limit).toBe(2)
    })
  })

  describe("GET/POST/DELETE /admin/marketing/outreach/:id", () => {
    it("retrieves, updates and deletes a single row", async () => {
      const created = await api.post(
        "/admin/marketing/outreach",
        { recipient_email: "single@example.com", campaign: `crud-${Date.now()}` },
        headers
      )
      const id = created.data.outreach.id

      const got = await api.get(`/admin/marketing/outreach/${id}`, headers)
      expect(got.status).toBe(200)
      expect(got.data.outreach.id).toBe(id)

      const updated = await api.post(
        `/admin/marketing/outreach/${id}`,
        { status: "replied", notes: "called back" },
        headers
      )
      expect(updated.status).toBe(200)
      expect(updated.data.outreach.status).toBe("replied")
      expect(updated.data.outreach.notes).toBe("called back")

      const del = await api.delete(`/admin/marketing/outreach/${id}`, headers)
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      await expect(
        api.get(`/admin/marketing/outreach/${id}`, headers)
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("404s retrieving an unknown id", async () => {
      await expect(
        api.get("/admin/marketing/outreach/mko_does_not_exist", headers)
      ).rejects.toMatchObject({ response: { status: 404 } })
    })
  })
})
