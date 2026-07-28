/**
 * #843 (approach #2) — the admin → partner read-proxy.
 *
 * These routes read a partner's internals through the partner portal's OWN
 * scoping helpers, driven by a synthesized `{ actor_id: partnerId }` context.
 * The contract worth pinning is exactly that: admin sees what the partner sees,
 * without a partner login, and cannot write through it.
 */
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-inspect-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `InspectTest ${unique}`,
      handle: `inspecttest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Inspect" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the bearer token carries partner actor context.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin partner inspection read-proxy (#843)", () => {
    let adminHeaders: any
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartner(api)
    })

    describe("GET /admin/partners/:id/orders", () => {
      it("returns the partner's order list without a partner login", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/orders`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.orders)).toBe(true)
        expect(res.data).toHaveProperty("count")
        expect(res.data).toHaveProperty("offset")
        expect(res.data).toHaveProperty("limit")
      })

      it("mirrors GET /partners/orders for the same partner and kind", async () => {
        // The whole point of the read-proxy: identical payload shape from the
        // two surfaces. If these ever diverge, the mirror has drifted and the
        // console is lying about what the partner sees.
        for (const kind of ["retail", "design", "inventory", "all"]) {
          const viaAdmin = await api.get(
            `/admin/partners/${partner.partnerId}/orders?kind=${kind}`,
            adminHeaders
          )
          const viaPartner = await api.get(`/partners/orders?kind=${kind}`, {
            headers: partner.headers,
          })

          expect(viaAdmin.status).toBe(200)
          expect(viaPartner.status).toBe(200)
          expect(viaAdmin.data.count).toBe(viaPartner.data.count)
          expect(viaAdmin.data.orders.map((o: any) => o.id)).toEqual(
            viaPartner.data.orders.map((o: any) => o.id)
          )
        }
      })

      it("rejects an unknown kind rather than silently defaulting", async () => {
        const err = await api
          .get(
            `/admin/partners/${partner.partnerId}/orders?kind=nonsense`,
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(400)
      })

      it("404s for an unknown partner instead of a partner-voiced 401", async () => {
        const err = await api
          .get("/admin/partners/partner_does_not_exist/orders", adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
        expect(err.response.data.message).toBe("Partner not found")
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/orders`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(`/admin/partners/${partner.partnerId}/orders`, {}, adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/onboarding-profile", () => {
      it("returns null when the partner never started the wizard", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/onboarding-profile`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.onboarding_profile).toBeNull()
      })

      it("reads back what the partner saved", async () => {
        const body = {
          what_they_sell: "apparel",
          person_type: "manufacturer",
          team_size: 12,
          does_weaving: true,
          completed: true,
        }
        await api.put("/partners/onboarding-profile", body, {
          headers: partner.headers,
        })

        const res = await api.get(
          `/admin/partners/${partner.partnerId}/onboarding-profile`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.onboarding_profile).toMatchObject(body)
        expect(res.data.onboarding_profile.partner_id).toBe(partner.partnerId)
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/onboarding-profile",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/designs", () => {
      it("mirrors GET /partners/designs — same ids, count and facets", async () => {
        // Seed a design the partner OWNS (self-serve create) so the comparison
        // runs over real rows rather than two empty lists agreeing with each
        // other, which would pass even if the mirror were broken.
        const created = await api.post(
          "/partners/designs",
          { name: `Inspect Design ${Date.now()}`, description: "mirror test" },
          { headers: partner.headers }
        )
        expect(created.status).toBe(201)

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/designs`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/designs", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.designs.map((d: any) => d.id)).toEqual(
          viaPartner.data.designs.map((d: any) => d.id)
        )
        expect(viaAdmin.data.facets).toEqual(viaPartner.data.facets)
        expect(viaAdmin.data.designs.length).toBeGreaterThan(0)
      })

      it("carries partner_info and is_owner through the proxy", async () => {
        // `is_owner` is per-viewer (#920) and the derived `partner_info` block is
        // the whole reason an operator opens this surface — if the proxy dropped
        // either, the list would render but say nothing useful.
        await api.post(
          "/partners/designs",
          { name: `Owned Design ${Date.now()}`, description: "ownership test" },
          { headers: partner.headers }
        )

        const res = await api.get(
          `/admin/partners/${partner.partnerId}/designs`,
          adminHeaders
        )

        const design = res.data.designs[0]
        expect(design.is_owner).toBe(true)
        expect(design.partner_info).toMatchObject({
          assigned_partner_id: partner.partnerId,
          partner_status: "incoming",
        })
      })

      it("mirrors the bucket + q filters, not just the unfiltered list", async () => {
        await api.post(
          "/partners/designs",
          { name: `Bucketed ${Date.now()}`, description: "filter test" },
          { headers: partner.headers }
        )

        for (const qs of ["bucket=yours", "bucket=completed", "q=Bucketed"]) {
          const viaAdmin = await api.get(
            `/admin/partners/${partner.partnerId}/designs?${qs}`,
            adminHeaders
          )
          const viaPartner = await api.get(`/partners/designs?${qs}`, {
            headers: partner.headers,
          })

          expect(viaAdmin.data.count).toBe(viaPartner.data.count)
          expect(viaAdmin.data.designs.map((d: any) => d.id)).toEqual(
            viaPartner.data.designs.map((d: any) => d.id)
          )
        }
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get("/admin/partners/partner_does_not_exist/designs", adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/designs`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(`/admin/partners/${partner.partnerId}/designs`, {}, adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/production-runs", () => {
      // Assign real work to the partner: admin creates a design, opens a
      // production run on it, and approves an assignment to this partner. That
      // is the only path that produces a partner-scoped run, and it is what an
      // operator would be inspecting.
      const assignRunToPartner = async () => {
        const design = await api.post(
          "/admin/designs",
          { name: `Run Design ${Date.now()}`, description: "run mirror test" },
          adminHeaders
        )
        const parent = await api.post(
          "/admin/production-runs",
          { design_id: design.data.design.id, quantity: 4 },
          adminHeaders
        )
        const approved = await api.post(
          `/admin/production-runs/${parent.data.production_run.id}/approve`,
          {
            assignments: [
              { partner_id: partner.partnerId, role: "stitching", quantity: 4 },
            ],
          },
          adminHeaders
        )
        expect(approved.status).toBe(200)
        return approved.data.result?.children?.[0]?.id
      }

      it("mirrors GET /partners/production-runs for an assigned run", async () => {
        const runId = await assignRunToPartner()
        expect(runId).toBeTruthy()

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/production-runs`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/production-runs", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.production_runs.map((r: any) => r.id)).toEqual(
          viaPartner.data.production_runs.map((r: any) => r.id)
        )
        expect(
          viaAdmin.data.production_runs.some((r: any) => r.id === runId)
        ).toBe(true)
      })

      it("scopes to the partner — another partner's runs never leak in", async () => {
        await assignRunToPartner()
        const other = await createPartner(api)

        const res = await api.get(
          `/admin/partners/${other.partnerId}/production-runs`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.production_runs).toHaveLength(0)
      })

      it("mirrors the status filter", async () => {
        await assignRunToPartner()

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/production-runs?status=pending`,
          adminHeaders
        )
        const viaPartner = await api.get(
          "/partners/production-runs?status=pending",
          { headers: partner.headers }
        )

        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.production_runs.map((r: any) => r.id)).toEqual(
          viaPartner.data.production_runs.map((r: any) => r.id)
        )
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/production-runs",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/production-runs`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(
            `/admin/partners/${partner.partnerId}/production-runs`,
            {},
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })
  })
})
