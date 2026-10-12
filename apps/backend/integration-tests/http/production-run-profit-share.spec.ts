import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(240000)

/**
 * #2322 — profit share on a partner run made with OUR material.
 *
 * The partner makes pieces on our material and sells them; they owe us a share
 * of the GROSS sale price. These tests pin the round trip the unit test cannot
 * see: the column and tables exist and are migrated, the routes validate, the
 * partner can only see and report on their OWN run, and the amount owed is
 * computed from the stored rows.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/production-run-profit-share
 */
setupSharedTestSuite(() => {
  describe("production run profit share (#2322)", () => {
    const { api, getContainer } = getSharedTestEnv()

    const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (e: any) {
        console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
        throw e
      }
    }

    async function createPartner(unique: number, tag: string) {
      const email = `ps-${tag}-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      const res = await api.post(
        "/partners",
        {
          name: `PS Partner ${tag} ${unique}`,
          handle: `ps-partner-${tag}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const owner = await createPartner(unique, "owner")
      const other = await createPartner(unique, "other")

      // The run is created straight through the module: what is under test is
      // the profit-share surface, not the run lifecycle.
      const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const run = await service.createProductionRuns({
        status: "in_progress",
        quantity: 10,
        partner_id: owner.partnerId,
        snapshot: {},
        captured_at: new Date(),
        metadata: { source: "partner.self_serve" },
      })
      return { adminHeaders, owner, other, runId: run.id as string }
    }

    it("computes what the partner owes from recorded sales and payments", async () => {
      const { adminHeaders, runId } = await setup()
      const base = `/admin/production-runs/${runId}/profit-share`

      // No arrangement yet: owed is null, not 0.
      const empty = await loud("get", () => api.get(base, adminHeaders))
      expect(empty.data.profit_share.summary.owed).toBeNull()
      expect(empty.data.profit_share.summary.status).toBe("none")

      // A sale is refused until there is an arrangement.
      const refused = await api
        .post(`${base}/sales`, { quantity: 1, unit_price: 100 }, adminHeaders)
        .catch((e) => e.response)
      expect(refused.status).toBe(400)

      await loud("set", () => api.post(base, { percent: 50 }, adminHeaders))

      const sold = await loud("sale", () =>
        api.post(`${base}/sales`, { quantity: 4, unit_price: 1000 }, adminHeaders)
      )
      expect(sold.status).toBe(201)
      expect(sold.data.profit_share.summary.owed).toBe(2000)
      expect(sold.data.profit_share.summary.unsold_quantity).toBe(6)

      const paid = await loud("pay", () =>
        api.post(
          `${base}/settlements`,
          { amount: 500, method: "cash", reference: "received by founder" },
          adminHeaders
        )
      )
      expect(paid.data.profit_share.summary.paid).toBe(500)
      expect(paid.data.profit_share.summary.balance).toBe(1500)
      expect(paid.data.profit_share.summary.status).toBe("open")

      // Reading it back from the database gives the same answer.
      const again = await api.get(base, adminHeaders)
      expect(again.data.profit_share.percent).toBe(50)
      expect(again.data.profit_share.sales).toHaveLength(1)
      expect(again.data.profit_share.settlements).toHaveLength(1)
      expect(again.data.profit_share.summary.balance).toBe(1500)

      // A mistaken sale can be removed, and the amount owed follows.
      const saleId = again.data.profit_share.sales[0].id
      const del = await loud("delete-sale", () =>
        api.delete(`${base}/sales/${saleId}`, adminHeaders)
      )
      expect(del.data.profit_share.summary.owed).toBe(0)
      expect(del.data.profit_share.summary.balance).toBe(-500)
      expect(del.data.profit_share.summary.status).toBe("no_sales")
    })

    it("refuses reporting more pieces sold than the run made, and bad bodies", async () => {
      const { adminHeaders, runId } = await setup()
      const base = `/admin/production-runs/${runId}/profit-share`
      await api.post(base, { percent: 50 }, adminHeaders)

      const tooMany = await api
        .post(`${base}/sales`, { quantity: 11, unit_price: 100 }, adminHeaders)
        .catch((e) => e.response)
      expect(tooMany.status).toBe(400)

      const badMethod = await api
        .post(`${base}/settlements`, { amount: 10, method: "upi" }, adminHeaders)
        .catch((e) => e.response)
      expect(badMethod.status).toBe(400)

      const badPercent = await api
        .post(base, { percent: 150 }, adminHeaders)
        .catch((e) => e.response)
      expect(badPercent.status).toBe(400)
    })

    it("lets the partner report sales on their own run, and only their own", async () => {
      const { adminHeaders, owner, other, runId } = await setup()
      await api.post(`/admin/production-runs/${runId}/profit-share`, { percent: 50 }, adminHeaders)

      const reported = await loud("partner-sale", () =>
        api.post(
          `/partners/production-runs/${runId}/profit-share/sales`,
          { quantity: 2, unit_price: 5700 },
          { headers: owner.partnerHeaders }
        )
      )
      expect(reported.status).toBe(201)
      expect(reported.data.sale.reported_by).toBe("partner")
      expect(reported.data.profit_share.summary.owed).toBe(5700)

      const seen = await api.get(`/partners/production-runs/${runId}/profit-share`, {
        headers: owner.partnerHeaders,
      })
      expect(seen.data.profit_share.summary.owed).toBe(5700)

      // Another partner gets a 404, not the run.
      const foreign = await api
        .get(`/partners/production-runs/${runId}/profit-share`, {
          headers: other.partnerHeaders,
        })
        .catch((e) => e.response)
      expect(foreign.status).toBe(404)

      const unauth = await api
        .get(`/partners/production-runs/${runId}/profit-share`)
        .catch((e) => e.response)
      expect(unauth.status).toBe(401)
    })
  })
})
