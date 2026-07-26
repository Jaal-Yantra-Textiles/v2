/**
 * #1172 — `GET /admin/production-runs?q=` used to be dropped silently: the route
 * never read the param, so a search returned an unfiltered first page and the
 * caller got no signal that the term had been ignored. A run has no name of its
 * own, so `q` resolves through its referents (design / partner / product name)
 * plus its own id.
 *
 * Also covers the sibling fix: `POST /admin/designs` with no `description` used
 * to 500 on the NOT NULL column instead of creating the draft.
 *
 * Everything lives in one `it()` on purpose — the shared runner restores the DB
 * before every test, so state created in `beforeAll` is gone by the next
 * sibling test.
 */
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("Production run list search (#1172)", () => {
    it("filters by design, partner and run id — and ignores nothing", async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      const adminHeaders = await getAuthHeaders(api)

      // Nonce-prefixed tokens so a match can only come from what this test made.
      const unique = `${Date.now()}`
      const silkToken = `silkzz${unique}`
      const cottonToken = `cottonzz${unique}`
      const weaverToken = `weaverzz${unique}`

      // ── Two designs, distinct searchable names ───────────────────────────────
      const silkDesign = await api.post(
        "/admin/designs",
        {
          name: `${silkToken} Saree`,
          description: "Silk design for run search",
          design_type: "Original",
          status: "Commerce_Ready",
        },
        adminHeaders
      )
      expect(silkDesign.status).toBe(201)
      const silkDesignId = silkDesign.data.design.id

      // Doubles as the description-default check: name-only create must succeed
      // (201 + description "") rather than 500 on the NOT NULL column.
      const cottonDesign = await api.post(
        "/admin/designs",
        { name: `${cottonToken} Kurta`, design_type: "Original" },
        adminHeaders
      )
      expect(cottonDesign.status).toBe(201)
      expect(cottonDesign.data.design.description).toBe("")
      const cottonDesignId = cottonDesign.data.design.id

      // ── A partner to hang the second run off ────────────────────────────────
      const partnerEmail = `run-search-${unique}@jyt.test`
      const partnerPassword = "supersecret"
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: partnerPassword,
      })
      const partnerLogin = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: partnerPassword,
      })
      const createPartnerRes = await api.post(
        "/partners",
        {
          name: `${weaverToken} Weaves`,
          handle: `${weaverToken}-weaves`,
          admin: {
            email: partnerEmail,
            first_name: "Run",
            last_name: "Search",
          },
        },
        { headers: { Authorization: `Bearer ${partnerLogin.data.token}` } }
      )
      expect(createPartnerRes.status).toBe(200)
      const partnerId = createPartnerRes.data.partner.id

      // ── One run per design; only the cotton run names the partner ───────────
      const silkRun = await api.post(
        "/admin/production-runs",
        { design_id: silkDesignId, quantity: 5 },
        adminHeaders
      )
      expect(silkRun.status).toBe(201)
      const silkRunId = silkRun.data.production_run.id

      const cottonRun = await api.post(
        "/admin/production-runs",
        { design_id: cottonDesignId, quantity: 7, partner_id: partnerId },
        adminHeaders
      )
      expect(cottonRun.status).toBe(201)
      const cottonRunId = cottonRun.data.production_run.id

      const listRuns = async (params: string) => {
        const res = await api.get(
          `/admin/production-runs${params}`,
          adminHeaders
        )
        expect(res.status).toBe(200)
        return res.data
      }

      // Baseline: no `q` returns both runs.
      const all = await listRuns("")
      const allIds = all.production_runs.map((r: any) => r.id)
      expect(allIds).toEqual(expect.arrayContaining([silkRunId, cottonRunId]))

      // Match by DESIGN name — the regression this issue is about. Before the
      // fix this returned both runs (term dropped), not just the silk one.
      const bySilk = await listRuns(`?q=${silkToken}`)
      expect(bySilk.production_runs.map((r: any) => r.id)).toEqual([silkRunId])
      expect(bySilk.count).toBe(1)

      // Match by PARTNER name.
      const byPartner = await listRuns(`?q=${weaverToken}`)
      expect(byPartner.production_runs.map((r: any) => r.id)).toEqual([
        cottonRunId,
      ])
      expect(byPartner.count).toBe(1)

      // Match by the run's own id.
      const byId = await listRuns(`?q=${silkRunId}`)
      expect(byId.production_runs.map((r: any) => r.id)).toEqual([silkRunId])

      // Case-insensitive (`$ilike`).
      const byUpper = await listRuns(`?q=${silkToken.toUpperCase()}`)
      expect(byUpper.production_runs.map((r: any) => r.id)).toEqual([silkRunId])

      // No match must mean no rows — not a silent unfiltered page.
      const byMiss = await listRuns(`?q=nomatchzz${unique}`)
      expect(byMiss.production_runs).toHaveLength(0)
      expect(byMiss.count).toBe(0)

      // `q` AND-s with the explicit filters rather than replacing them.
      const bySilkWrongStatus = await listRuns(`?q=${silkToken}&status=cancelled`)
      expect(bySilkWrongStatus.production_runs).toHaveLength(0)

      const bySilkRightStatus = await listRuns(
        `?q=${silkToken}&status=pending_review`
      )
      expect(bySilkRightStatus.production_runs.map((r: any) => r.id)).toEqual([
        silkRunId,
      ])

      // A blank/whitespace `q` is not a filter.
      const byBlank = await listRuns("?q=%20%20")
      expect(byBlank.production_runs.map((r: any) => r.id)).toEqual(
        expect.arrayContaining([silkRunId, cottonRunId])
      )
    })
  })
})
