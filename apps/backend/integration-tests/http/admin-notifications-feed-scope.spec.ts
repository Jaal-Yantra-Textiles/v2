import { Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createPartnerNotification } from "../../src/lib/notifications/create-partner-notification"

jest.setTimeout(120 * 1000)

/**
 * The admin timeline listed every partner's bell rows: a partner row is a
 * `feed` row with `receiver_id = partner.id`, and the admin list never filtered
 * on it (founder, 2026-10-31 — "Open it to accept the work" in the admin feed).
 */
setupSharedTestSuite(() => {
  describe("GET /admin/notifications — feed is the admin's", () => {
    const { api, getContainer } = getSharedTestEnv()
    let headers: any

    beforeAll(async () => {
      await createAdminUser(getContainer())
      headers = await getAuthHeaders(api)
    })

    it("hides partner bell rows from the admin feed, keeps them reachable", async () => {
      const container = getContainer()
      const notifications: any = container.resolve(Modules.NOTIFICATION)
      const partnerId = `01TESTPARTNER${Date.now()}`

      await notifications.createNotifications({
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: { title: "Production Run Dispatched", description: "admin row" },
      })
      await createPartnerNotification(container, {
        partner_id: partnerId,
        title: "New design: Test",
        description: "Open it to accept the work.",
        idempotency_key: `test:${partnerId}`,
      })

      const titles = (rows: any[]) => rows.map((n) => n?.data?.title)

      for (const path of ["/admin/notifications", "/admin/notifications/custom"]) {
        const feed = await api.get(`${path}?channel=feed&limit=50&fields=id,receiver_id,data`, headers)
        expect(feed.status).toBe(200)
        expect(titles(feed.data.notifications)).toContain("Production Run Dispatched")
        expect(titles(feed.data.notifications)).not.toContain("New design: Test")
      }

      // Opt back in: one partner's rows, or everything.
      const one = await api.get(
        `/admin/notifications/custom?channel=feed&receiver_id=${partnerId}&fields=id,receiver_id,data`,
        headers
      )
      expect(titles(one.data.notifications)).toEqual(["New design: Test"])

      const all = await api.get(
        "/admin/notifications/custom?channel=feed&include_partner=true&limit=50&fields=id,data",
        headers
      )
      expect(titles(all.data.notifications)).toEqual(
        expect.arrayContaining(["Production Run Dispatched", "New design: Test"])
      )
    })
  })
})
