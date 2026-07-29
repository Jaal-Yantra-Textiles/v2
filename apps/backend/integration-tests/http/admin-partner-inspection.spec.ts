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

    // Provision a store (with its default sales channel and stock location) and
    // put a product in it. The partner catalog is sales-channel-scoped and the
    // inventory surface is location-scoped, so without a real store both
    // surfaces return empty and a mirror comparison would pass against a
    // broken proxy — two empty lists always agree.
    const provisionStoreWithProduct = async () => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)

      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
        const currencies = currenciesRes.data.currencies || []
        const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
        const currencyCode = String((usd || currencies[0]).code).toLowerCase()

        const storeRes = await api.post(
          "/partners/stores",
          {
            store: {
              name: `InspectStore ${unique}`,
              supported_currencies: [
                { currency_code: currencyCode, is_default: true },
              ],
            },
            sales_channel: {
              name: `InspectChannel ${unique}`,
              description: "Default",
            },
            region: {
              name: "Default Region",
              currency_code: currencyCode,
              countries: ["us"],
            },
            location: {
              name: "Warehouse",
              address: {
                address_1: "1 Main St",
                city: "NY",
                postal_code: "10001",
                country_code: "US",
              },
            },
          },
          { headers: partner.headers }
        )
        const storeId = storeRes.data.store.id

        const productRes = await api.post(
          `/partners/stores/${storeId}/products`,
          {
            title: `Inspect Product ${unique}`,
            handle: `inspect-prod-${unique}`,
            status: "published",
            options: [{ title: "Color", values: ["Red"] }],
            variants: [
              {
                title: "Red",
                sku: `INSPECT-SKU-${unique}`,
                options: { Color: "Red" },
                prices: [{ amount: 1500, currency_code: currencyCode }],
              },
            ],
          },
          { headers: partner.headers }
        )

        return { storeId, productId: productRes.data.product?.id }
    }

    describe("GET /admin/partners/:id/products", () => {
      it("mirrors GET /partners/stores/:id/products — same ids and count", async () => {
        const { storeId, productId } = await provisionStoreWithProduct()
        expect(productId).toBeTruthy()

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/products`,
          adminHeaders
        )
        const viaPartner = await api.get(
          `/partners/stores/${storeId}/products`,
          { headers: partner.headers }
        )

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.products.map((p: any) => p.id)).toEqual(
          viaPartner.data.products.map((p: any) => p.id)
        )
        expect(viaAdmin.data.products.length).toBeGreaterThan(0)
        expect(viaAdmin.data.store_id).toBe(storeId)
        expect(viaAdmin.data.partner_id).toBe(partner.partnerId)
      })

      it("mirrors an explicitly selected store", async () => {
        const { storeId } = await provisionStoreWithProduct()

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/products?store_id=${storeId}`,
          adminHeaders
        )
        const viaPartner = await api.get(
          `/partners/stores/${storeId}/products`,
          { headers: partner.headers }
        )

        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.products.map((p: any) => p.id)).toEqual(
          viaPartner.data.products.map((p: any) => p.id)
        )
      })

      it("scopes to the partner — another partner's catalog never leaks in", async () => {
        const { productId } = await provisionStoreWithProduct()
        const other = await createPartner(api)

        const res = await api.get(
          `/admin/partners/${other.partnerId}/products`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(
          res.data.products.some((p: any) => p.id === productId)
        ).toBe(false)
      })

      it("404s on a store belonging to someone else, not a partner-voiced 401", async () => {
        const { storeId } = await provisionStoreWithProduct()
        const other = await createPartner(api)

        const err = await api
          .get(
            `/admin/partners/${other.partnerId}/products?store_id=${storeId}`,
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("returns an empty catalog for a partner with no store yet", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/products`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.products).toHaveLength(0)
        expect(res.data.store_id).toBeNull()
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get("/admin/partners/partner_does_not_exist/products", adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/products`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(
            `/admin/partners/${partner.partnerId}/products`,
            {},
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/inventory-orders", () => {
      it("mirrors GET /partners/inventory-orders — same ids and count", async () => {
        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-orders`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/inventory-orders", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.inventory_orders.map((o: any) => o.id)).toEqual(
          viaPartner.data.inventory_orders.map((o: any) => o.id)
        )
      })

      it("mirrors the status + q filters, not just the unfiltered list", async () => {
        // Filters are where a re-implementation diverges, so they are checked
        // even when the set is empty for this partner — an admin-side filter
        // that silently ignored `status` would still show up as a count or id
        // mismatch the moment rows exist.
        // `Pending`, capitalised — the status enum is the canonical set in
        // modules/inventory_orders/constants.ts, and lowercase is rejected.
        for (const qs of ["status=Pending", "q=warehouse", "limit=5&offset=0"]) {
          const viaAdmin = await api.get(
            `/admin/partners/${partner.partnerId}/inventory-orders?${qs}`,
            adminHeaders
          )
          const viaPartner = await api.get(
            `/partners/inventory-orders?${qs}`,
            { headers: partner.headers }
          )

          expect(viaAdmin.data.count).toBe(viaPartner.data.count)
          expect(viaAdmin.data.inventory_orders.map((o: any) => o.id)).toEqual(
            viaPartner.data.inventory_orders.map((o: any) => o.id)
          )
        }
      })

      it("rejects an invalid status exactly as the partner surface does", async () => {
        // The mirror must not be MORE PERMISSIVE than what it mirrors. This
        // caught a real bug: the proxy first parsed the loose schema in
        // `partners/inventory-orders/validators.ts` (status: string) while the
        // partner matcher validates with the admin schema (status: enum), so
        // `?status=pending` returned 200 here and 400 there.
        const viaAdmin = await api
          .get(
            `/admin/partners/${partner.partnerId}/inventory-orders?status=pending`,
            adminHeaders
          )
          .catch((e: any) => e)
        const viaPartner = await api
          .get("/partners/inventory-orders?status=pending", {
            headers: partner.headers,
          })
          .catch((e: any) => e)

        expect(viaAdmin.response.status).toBe(400)
        expect(viaPartner.response.status).toBe(400)
      })

      it("echoes the pagination contract", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-orders?limit=5&offset=0`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.limit).toBe(5)
        expect(res.data.offset).toBe(0)
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/inventory-orders",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/inventory-orders`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(
            `/admin/partners/${partner.partnerId}/inventory-orders`,
            {},
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/inventory-items", () => {
      // Seed real stock: the store gives the partner a location, and the
      // partner's own POST creates the item plus a level at that location.
      // Without it both surfaces return empty and agree for the wrong reason.
      const seedStock = async () => {
        await provisionStoreWithProduct()
        const unique = Date.now() + Math.random().toString(36).slice(2, 6)
        const created = await api.post(
          "/partners/inventory-items",
          { sku: `INSPECT-INV-${unique}`, title: `Inspect Item ${unique}` },
          { headers: partner.headers }
        )
        return created.data.inventory_item?.id
      }

      it("mirrors GET /partners/inventory-items — same ids and count", async () => {
        const itemId = await seedStock()
        expect(itemId).toBeTruthy()

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-items`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/inventory-items", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.inventory_items.map((i: any) => i.id)).toEqual(
          viaPartner.data.inventory_items.map((i: any) => i.id)
        )
        expect(
          viaAdmin.data.inventory_items.some((i: any) => i.id === itemId)
        ).toBe(true)
      })

      it("carries the location-scoped quantity aggregation through the proxy", async () => {
        // The top-level quantities are computed by the workflow (the inventory
        // service returns them null), and they are location-scoped — a global
        // figure here would be a different, misleading number.
        await seedStock()

        const res = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-items`,
          adminHeaders
        )

        const item = res.data.inventory_items[0]
        expect(item).toBeTruthy()
        expect(typeof item.stocked_quantity).toBe("number")
        expect(Array.isArray(item.location_levels)).toBe(true)
      })

      it("scopes to the partner — another partner's stock never leaks in", async () => {
        const itemId = await seedStock()
        const other = await createPartner(api)

        const res = await api.get(
          `/admin/partners/${other.partnerId}/inventory-items`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(
          res.data.inventory_items.some((i: any) => i.id === itemId)
        ).toBe(false)
      })

      it("returns an empty list for a partner with no store or location", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-items`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.inventory_items).toHaveLength(0)
        expect(res.data.count).toBe(0)
      })

      it("mirrors the q filter", async () => {
        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/inventory-items?q=nothingmatches`,
          adminHeaders
        )
        const viaPartner = await api.get(
          "/partners/inventory-items?q=nothingmatches",
          { headers: partner.headers }
        )

        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.inventory_items.map((i: any) => i.id)).toEqual(
          viaPartner.data.inventory_items.map((i: any) => i.id)
        )
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/inventory-items",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/inventory-items`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — the partner route's POST is NOT mirrored", async () => {
        const err = await api
          .post(
            `/admin/partners/${partner.partnerId}/inventory-items`,
            { sku: "SHOULD-NOT-EXIST" },
            adminHeaders
          )
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

    /**
     * Slice 5 — the storefront surface.
     *
     * Two things make it unlike the other four. First, the admin storefront
     * route PRE-DATES the mirror and used to hand-roll the partner logic, so
     * these tests pin a reconciliation, not just a new route. Second, both
     * partner routes here WRITE off the back of their read (stale-ref cleanup,
     * website_id backfill) — the mirror must produce the same view without
     * performing either, which is asserted directly rather than assumed.
     *
     * Hosting cannot be provisioned in tests (no Vercel/Cloudflare creds), so
     * the seed sets the partner's storefront_domain + a real website record —
     * the state a provisioned partner is in from the website surface's point of
     * view, which is the part this slice mirrors.
     */
    describe("storefront / website", () => {
      const seedWebsite = async (partnerId: string) => {
        const unique = Date.now() + Math.random().toString(36).slice(2, 6)
        const domain = `inspect-${unique}.example.com`

        const websiteRes = await api.post(
          "/admin/websites",
          { domain, name: `Inspect Site ${unique}` },
          adminHeaders
        )
        const websiteId = websiteRes.data.website.id

        await api.post(
          `/admin/websites/${websiteId}/pages`,
          {
            title: `Inspect Page ${unique}`,
            slug: `inspect-page-${unique}`,
            content: "seeded for the inspection mirror",
            page_type: "Custom",
            status: "Published",
          },
          adminHeaders
        )

        // Point the partner at it the way provisioning would. Done through the
        // module rather than an API because storefront provisioning needs
        // hosting credentials this suite does not have.
        const partnerService: any = getContainer().resolve("partner")
        await partnerService.updatePartners({
          id: partnerId,
          storefront_domain: domain,
          website_id: websiteId,
        })

        return { domain, websiteId }
      }

      it("mirrors GET /partners/storefront/website over a seeded website", async () => {
        const { websiteId, domain } = await seedWebsite(partner.partnerId)

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/website`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/storefront/website", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.website.id).toBe(viaPartner.data.website.id)
        expect(viaAdmin.data.website.id).toBe(websiteId)
        expect(viaAdmin.data.website.domain).toBe(domain)
      })

      it("mirrors GET /partners/storefront/pages over seeded pages", async () => {
        await seedWebsite(partner.partnerId)

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/pages`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/storefront/pages", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        // Seeded, so this is a comparison of NON-empty lists — two empty ones
        // agree even against a completely broken mirror.
        expect(viaAdmin.data.count).toBeGreaterThan(0)
        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.pages.map((p: any) => p.id)).toEqual(
          viaPartner.data.pages.map((p: any) => p.id)
        )
      })

      it("mirrors the pages status filter", async () => {
        await seedWebsite(partner.partnerId)

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/pages?status=Published`,
          adminHeaders
        )
        const viaPartner = await api.get(
          "/partners/storefront/pages?status=Published",
          { headers: partner.headers }
        )

        expect(viaAdmin.data.count).toBe(viaPartner.data.count)
        expect(viaAdmin.data.pages.map((p: any) => p.id)).toEqual(
          viaPartner.data.pages.map((p: any) => p.id)
        )
      })

      it("exposes the partner theme editor's own preview URL", async () => {
        const { domain } = await seedWebsite(partner.partnerId)

        const res = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/website`,
          adminHeaders
        )

        // Same URL apps/partner-ui builds for its theme-editor iframe, so the
        // operator sees the storefront as the partner is editing it.
        expect(res.data.preview_url).toBe(`https://${domain}/?theme_editor=true`)
      })

      it("reports an unprovisioned storefront as a state, not an error", async () => {
        // The partner surface 404s here; the mirror deliberately does not —
        // "no storefront yet" is the normal state the onboarding flow exists to
        // fix, and an operator has to be able to see it.
        const website = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/website`,
          adminHeaders
        )
        expect(website.status).toBe(200)
        expect(website.data.website).toBeNull()
        expect(website.data.reason).toBe("not_provisioned")

        const pages = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/pages`,
          adminHeaders
        )
        expect(pages.status).toBe(200)
        expect(pages.data.pages).toHaveLength(0)
        expect(pages.data.website_id).toBeNull()
      })

      it("does NOT backfill website_id — the mirror never writes", async () => {
        const { websiteId, domain } = await seedWebsite(partner.partnerId)

        // Clear website_id so resolution has to fall back to the domain lookup.
        // That fallback is exactly what makes the PARTNER route write.
        const partnerService: any = getContainer().resolve("partner")
        await partnerService.updatePartners({
          id: partner.partnerId,
          website_id: null,
        })

        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/storefront/website`,
          adminHeaders
        )
        expect(viaAdmin.data.website.id).toBe(websiteId)
        expect(viaAdmin.data.resolved_by).toBe("domain")

        // Still null: the admin read resolved via the domain but wrote nothing.
        const after = await partnerService.retrievePartner(partner.partnerId)
        expect(after.website_id ?? null).toBeNull()
        expect(after.storefront_domain).toBe(domain)
      })

      it("mirrors GET /partners/storefront hosting status", async () => {
        const viaAdmin = await api.get(
          `/admin/partners/${partner.partnerId}/storefront`,
          adminHeaders
        )
        const viaPartner = await api.get("/partners/storefront", {
          headers: partner.headers,
        })

        expect(viaAdmin.status).toBe(200)
        expect(viaAdmin.data.provisioned).toBe(viaPartner.data.provisioned)
        expect(viaAdmin.data.provider).toBe(viaPartner.data.provider)
        // The flags the pre-mirror admin copy silently omitted — pinned so the
        // reconciliation cannot quietly regress.
        expect(viaAdmin.data.vercel_configured).toBe(
          viaPartner.data.vercel_configured
        )
        expect(viaAdmin.data.cloudflare_configured).toBe(
          viaPartner.data.cloudflare_configured
        )
      })

      it("scopes to the partner — another partner's website never leaks in", async () => {
        await seedWebsite(partner.partnerId)
        const other = await createPartner(api)

        const res = await api.get(
          `/admin/partners/${other.partnerId}/storefront/website`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.website).toBeNull()
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/storefront/website",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/storefront/website`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(
            `/admin/partners/${partner.partnerId}/storefront/pages`,
            { title: "nope", slug: "nope", content: "nope" },
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })
  })
})
