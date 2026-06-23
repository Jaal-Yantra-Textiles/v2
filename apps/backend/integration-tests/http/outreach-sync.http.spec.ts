/**
 * #659 slice 4 / PR-4d — POST /admin/marketing/outreach/sync.
 *
 * Exercises the live engagement-reconciliation route against the shared test DB:
 *   - dry-run previews the change set without writing,
 *   - apply advances status + fills timestamps,
 *   - re-applying the same events is idempotent (zero changes),
 *   - events match by external_id, and unmatched events are counted not fatal,
 *   - a missing `events` array 400s.
 *
 * Rows are seeded via the CRM create route under a unique campaign so the
 * assertions are insensitive to rows left by other suites (shared DB TRUNCATEs
 * between files, not between it()s).
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

  const seedRow = async (over: Record<string, unknown> = {}) => {
    const res = await api.post(
      "/admin/marketing/outreach",
      {
        recipient_email: `sync-${Date.now()}-${Math.random()}@example.com`,
        campaign: `sync-${Date.now()}`,
        external_id: `msg-${Date.now()}-${Math.random()}`,
        ...over,
      },
      headers
    )
    expect(res.status).toBe(201)
    return res.data.outreach
  }

  describe("POST /admin/marketing/outreach/sync", () => {
    it("previews on dry-run without writing", async () => {
      const row = await seedRow()

      const preview = await api.post(
        "/admin/marketing/outreach/sync",
        {
          dry_run: true,
          events: [{ id: row.id, opened_at: "2026-06-23T10:00:00.000Z" }],
        },
        headers
      )

      expect(preview.status).toBe(200)
      expect(preview.data.dry_run).toBe(true)
      expect(preview.data.applied).toBe(false)
      expect(preview.data.matched).toBe(1)
      expect(preview.data.changes.length).toBeGreaterThan(0)

      // No write happened.
      const after = await api.get(
        `/admin/marketing/outreach/${row.id}`,
        headers
      )
      expect(after.data.outreach.status).toBe("queued")
      expect(after.data.outreach.opened_at).toBeFalsy()
    })

    it("applies engagement and is idempotent on re-apply", async () => {
      const row = await seedRow()
      const events = [{ id: row.id, opened_at: "2026-06-23T10:00:00.000Z" }]

      const applied = await api.post(
        "/admin/marketing/outreach/sync",
        { dry_run: false, events },
        headers
      )
      expect(applied.status).toBe(200)
      expect(applied.data.applied).toBe(true)

      const after = await api.get(
        `/admin/marketing/outreach/${row.id}`,
        headers
      )
      expect(after.data.outreach.status).toBe("opened")
      expect(after.data.outreach.opened_at).toBeTruthy()

      // Same events again → nothing to do.
      const again = await api.post(
        "/admin/marketing/outreach/sync",
        { dry_run: false, events },
        headers
      )
      expect(again.data.applied).toBe(false)
      expect(again.data.changes).toHaveLength(0)
    })

    it("matches by external_id and counts unmatched events", async () => {
      const ext = `ext-${Date.now()}`
      const row = await seedRow({ external_id: ext })

      const res = await api.post(
        "/admin/marketing/outreach/sync",
        {
          dry_run: false,
          events: [
            { external_id: ext, replied_at: "2026-06-23T12:00:00.000Z" },
            { external_id: "does-not-exist" },
          ],
        },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.matched).toBe(1)
      expect(res.data.unmatched_events).toBe(1)

      const after = await api.get(
        `/admin/marketing/outreach/${row.id}`,
        headers
      )
      expect(after.data.outreach.status).toBe("replied")
    })

    it("400s when events is missing", async () => {
      await expect(
        api.post("/admin/marketing/outreach/sync", { dry_run: true }, headers)
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
