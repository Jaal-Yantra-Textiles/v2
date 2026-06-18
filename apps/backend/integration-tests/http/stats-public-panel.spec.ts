import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { STATS_MODULE } from "../../src/modules/stats"

jest.setTimeout(60 * 1000)

/**
 * #341 / roadmap #20 — share-publicly UX (backend slice).
 *
 * Covers the restored public REST endpoint `GET /web/stats/panels/:id/data`
 * (opt-in via `metadata.public === true`, private/unknown → identical 404)
 * and the server-side audit stamping on the admin PUT route
 * (`public_set_by` / `public_set_at` written on a real toggle).
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  // A minimal valid panel operation. The admin PUT route re-validates
  // operation_options on every update (its schema defaults to {}), and the
  // real panel-editor always saves the whole panel — so PUTs echo these.
  const OP_TYPE = "aggregate_data"
  const OP_OPTIONS = { entity: "order", aggregate: { fn: "count" } }

  const seedPanel = async (metadata: Record<string, any>) => {
    const service: any = getContainer().resolve(STATS_MODULE)
    const dashboard = await service.createStatsDashboards({ name: "Public test dashboard" })
    const panel = await service.createStatsPanels({
      name: "Public test panel",
      type: "metric",
      operation_type: OP_TYPE,
      operation_options: OP_OPTIONS,
      display: {},
      dashboard_id: dashboard.id,
      metadata,
    })
    return panel
  }

  describe("GET /web/stats/panels/:id/data (public)", () => {
    it("returns 404 for a private panel (default — not opted in)", async () => {
      const panel = await seedPanel({})
      await expect(
        api.get(`/web/stats/panels/${panel.id}/data`)
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("returns 404 for an unknown panel id (no existence leak)", async () => {
      await expect(
        api.get(`/web/stats/panels/panel_does_not_exist/data`)
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("returns 200 with the public shape + cache headers for a shared panel", async () => {
      const panel = await seedPanel({ public: true })
      const res = await api.get(`/web/stats/panels/${panel.id}/data`)

      expect(res.status).toBe(200)
      expect(res.data).toEqual(
        expect.objectContaining({
          panel_id: panel.id,
          type: "metric",
          name: "Public test panel",
        })
      )
      expect(res.data).toHaveProperty("data")
      expect(res.data).toHaveProperty("resolved_at")
      expect(res.headers["cache-control"]).toBe(
        "public, s-maxage=120, stale-while-revalidate=300"
      )
    })
  })

  describe("PUT /admin/stats/panels/:id audit stamping", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("stamps public_set_by + public_set_at when toggled public, and the panel becomes reachable", async () => {
      const panel = await seedPanel({})

      const put = await api.put(
        `/admin/stats/panels/${panel.id}`,
        { operation_type: OP_TYPE, operation_options: OP_OPTIONS, metadata: { public: true } },
        adminHeaders
      )
      expect(put.status).toBe(200)
      expect(put.data.panel.metadata.public).toBe(true)
      expect(put.data.panel.metadata.public_set_by).toBeTruthy()
      expect(put.data.panel.metadata.public_set_at).toBeTruthy()

      // now publicly reachable
      const pub = await api.get(`/web/stats/panels/${panel.id}/data`)
      expect(pub.status).toBe(200)
    })

    it("preserves the stamps on an unrelated metadata edit while staying public", async () => {
      const panel = await seedPanel({})

      const first = await api.put(
        `/admin/stats/panels/${panel.id}`,
        { operation_type: OP_TYPE, operation_options: OP_OPTIONS, metadata: { public: true } },
        adminHeaders
      )
      const setAt = first.data.panel.metadata.public_set_at
      const setBy = first.data.panel.metadata.public_set_by

      // client edits metadata but drops the audit keys
      const second = await api.put(
        `/admin/stats/panels/${panel.id}`,
        {
          operation_type: OP_TYPE,
          operation_options: OP_OPTIONS,
          metadata: { public: true, note: "edited" },
        },
        adminHeaders
      )
      expect(second.data.panel.metadata.note).toBe("edited")
      expect(second.data.panel.metadata.public_set_at).toBe(setAt)
      expect(second.data.panel.metadata.public_set_by).toBe(setBy)
    })

    it("re-gates to 404 when toggled back to private", async () => {
      const panel = await seedPanel({ public: true })
      await api.put(
        `/admin/stats/panels/${panel.id}`,
        { operation_type: OP_TYPE, operation_options: OP_OPTIONS, metadata: { public: false } },
        adminHeaders
      )
      await expect(
        api.get(`/web/stats/panels/${panel.id}/data`)
      ).rejects.toMatchObject({ response: { status: 404 } })
    })
  })
})
