import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240000)

/**
 * What a production run's cost is DENOMINATED IN, end to end (#1979).
 *
 * ## The bug this exists to keep out
 *
 * A run carried `partner_cost_estimate` as a bare number and `cost_type` saying
 * whether it was per-unit or total. Nothing said which CURRENCY, and
 * `RunCostSummary` had no currency field either — so when approval turned a
 * run's cost into a listed price it had to GUESS. It guessed
 * `design.cost_currency || <store default> || "inr"`, and the house store's
 * default is EUR, which made the INR last resort UNREACHABLE. A jacket costed
 * at ₹2,634.75 was listed as €2,634.75 and the FX fanout propagated that base
 * into all 11 currencies — ₹291,560, about 110× its cost.
 *
 * ## Why these are HTTP tests and not more unit tests
 *
 * The unit tests already pin the resolver. What they cannot see is whether the
 * value SURVIVES the round trip: that the column exists and is migrated, that
 * the route accepts and normalises it, that `computeRunCostSummary` reads it
 * back, and that approval writes a price in it. Every one of those is a place
 * the currency could be dropped while the pure function stays green.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/production-run-cost-currency
 */
setupSharedTestSuite(() => {
  describe("production run cost_currency (#1979)", () => {
    const { api, getContainer } = getSharedTestEnv()

    const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (e: any) {
        console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
        throw e
      }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      return { adminHeaders, unique }
    }

    async function createPartner(unique: number, tag: string) {
      const email = `ccy-${tag}-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      let login = await api.post("/auth/partner/emailpass", { email, password })
      const headers = { Authorization: `Bearer ${login.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Ccy Partner ${tag} ${unique}`,
          handle: `ccy-partner-${tag}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    async function createTemplate(adminHeaders: any, unique: number) {
      const name = `ccy-cutting-${unique}`
      await api.post(
        "/admin/task-templates",
        {
          name,
          description: "Cutting",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: `Ccy Test ${unique}`,
        },
        adminHeaders
      )
      return name
    }

    /**
     * A design costed with NO `cost_currency` — the state 45 of the 47 costed
     * designs on prod are in, and the one that made the guess reachable.
     */
    async function createUnstatedDesign(adminHeaders: any, unique: number, tag = "a") {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Ccy Design ${tag} ${unique}`,
          description: "Design with no stated cost currency",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          estimated_cost: 850,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      expect(res.data.design.cost_currency ?? null).toBeNull()
      return res.data.design.id
    }

    async function completeRun(runId: string, partnerHeaders: any, produced = 10) {
      await api.post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
      await api.post(`/partners/production-runs/${runId}/finish`, {}, { headers: partnerHeaders })
      const res = await api.post(
        `/partners/production-runs/${runId}/complete`,
        { produced_quantity: produced },
        { headers: partnerHeaders }
      )
      expect(res.data.production_run.status).toBe("completed")
    }

    async function oneCompletedRun(adminHeaders: any, unique: number, tag = "a") {
      const template = await createTemplate(adminHeaders, unique)
      const designId = await createUnstatedDesign(adminHeaders, unique, tag)
      const p = await createPartner(unique, tag)

      const createRes = await loud("create-runs", () =>
        api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 10,
            assignments: [
              { partner_id: p.partnerId, quantity: 10, template_names: [template] },
            ],
          },
          adminHeaders
        )
      )
      const children = createRes.data.children
      expect(children).toHaveLength(1)
      await completeRun(children[0].id, p.partnerHeaders)
      return { designId, runId: children[0].id as string }
    }

    const readRun = async (adminHeaders: any, runId: string) =>
      (await api.get(`/admin/production-runs/${runId}`, adminHeaders)).data
        .production_run

    const readProduct = async (adminHeaders: any, productId: string) =>
      (
        await api.get(
          `/admin/products/${productId}?fields=*variants,*variants.prices`,
          adminHeaders
        )
      ).data.product

    // ---- the column exists and round-trips -------------------------------

    it("stores the run's cost_currency, normalised", async () => {
      const { adminHeaders, unique } = await setup()
      const { runId } = await oneCompletedRun(adminHeaders, unique, "store")

      // A new run has never stated one. NULL, not a plausible default.
      expect((await readRun(adminHeaders, runId)).cost_currency ?? null).toBeNull()

      const res = await loud("set-currency", () =>
        api.post(
          `/admin/production-runs/${runId}`,
          { partner_cost_estimate: 500, cost_type: "total", cost_currency: "  USD " },
          adminHeaders
        )
      )
      expect(res.status).toBe(200)

      // Trimmed and lowercased on the way in — prices are stored lowercase.
      expect((await readRun(adminHeaders, runId)).cost_currency).toBe("usd")
    })

    it("refuses free text, and accepts null to clear it", async () => {
      const { adminHeaders, unique } = await setup()
      const { runId } = await oneCompletedRun(adminHeaders, unique, "valid")

      /*
       * 🔴 A free-text currency is how a price ends up labelled "Rupees" and
       * matched by no region at all. Rejected at the door.
       */
      for (const bad of ["rupees", "in", "inrr", "1nr", ""]) {
        const res = await api.post(
          `/admin/production-runs/${runId}`,
          { cost_currency: bad },
          { ...adminHeaders, validateStatus: () => true }
        )
        expect(res.status).toBe(400)
      }

      await api.post(
        `/admin/production-runs/${runId}`,
        { cost_currency: "aud" },
        adminHeaders
      )
      expect((await readRun(adminHeaders, runId)).cost_currency).toBe("aud")

      // null is a real state — "never stated" — not a way of saying INR.
      const cleared = await api.post(
        `/admin/production-runs/${runId}`,
        { cost_currency: null },
        adminHeaders
      )
      expect(cleared.status).toBe(200)
      expect((await readRun(adminHeaders, runId)).cost_currency ?? null).toBeNull()
    })

    // ---- the cost summary carries it -------------------------------------

    it("reports the currency on the cost summary, and null when unstated", async () => {
      const { adminHeaders, unique } = await setup()
      const { runId } = await oneCompletedRun(adminHeaders, unique, "summary")

      /*
       * 🔴 null, NOT "inr". The fallback belongs to the caller, which has the
       * design's currency to try next. Defaulting here would hide an unstated
       * run behind a plausible answer — and hiding it is what made #1979 take
       * two months and a customer-facing price to notice.
       */
      const before = await api.get(
        `/admin/production-runs/${runId}/cost-summary`,
        adminHeaders
      )
      expect(before.status).toBe(200)
      expect(before.data.cost_summary.currency ?? null).toBeNull()

      await api.post(
        `/admin/production-runs/${runId}`,
        { cost_currency: "usd" },
        adminHeaders
      )

      const after = await api.get(
        `/admin/production-runs/${runId}/cost-summary`,
        adminHeaders
      )
      expect(after.data.cost_summary.currency).toBe("usd")
    })

    // ---- the whole point: approval prices in it ---------------------------

    /**
     * 🔴 THE REGRESSION, at HTTP level.
     *
     * The design states NO currency, so the old chain fell through to the store
     * default. The house store's default is EUR — that is what listed ₹2,634.75
     * as €2,634.75. With the store out of the chain the price must land in INR.
     */
    it("does not list an unstated design in the store's default currency", async () => {
      const { adminHeaders, unique } = await setup()
      const { runId } = await oneCompletedRun(adminHeaders, unique, "fallback")

      const res = await loud("approve-fallback", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: [runId], decision: "approve" },
          adminHeaders
        )
      )
      const productId = res.data.run_approvals.created_product_ids[0]
      expect(productId).toBeTruthy()

      const product = await readProduct(adminHeaders, productId)
      const currencies = (product.variants?.[0]?.prices ?? []).map(
        (p: any) => String(p.currency_code).toLowerCase()
      )
      expect(currencies).toContain("inr")
      expect(currencies).not.toContain("eur")
    })

    /**
     * 🔴 The RUN outranks the design. `resolveApprovalPrice` prefers the run's
     * actual cost over the design's estimate, so the denomination has to follow
     * the same record — otherwise the price is valued by one and labelled by
     * the other.
     */
    it("lists in the RUN's currency when the run states one", async () => {
      const { adminHeaders, unique } = await setup()
      const { runId } = await oneCompletedRun(adminHeaders, unique, "runwins")

      /*
       * A costed run: `partner_cost_estimate` gives it a real `cost_per_unit`,
       * so the price comes from the RUN and not from the design's estimate.
       */
      await loud("price-run", () =>
        api.post(
          `/admin/production-runs/${runId}`,
          {
            partner_cost_estimate: 1000,
            cost_type: "total",
            cost_currency: "usd",
          },
          adminHeaders
        )
      )
      expect((await readRun(adminHeaders, runId)).cost_currency).toBe("usd")

      const res = await loud("approve-runwins", () =>
        api.post(
          "/admin/production-runs/approvals",
          { run_ids: [runId], decision: "approve" },
          adminHeaders
        )
      )
      const productId = res.data.run_approvals.created_product_ids[0]
      expect(productId).toBeTruthy()

      const product = await readProduct(adminHeaders, productId)
      const currencies = (product.variants?.[0]?.prices ?? []).map(
        (p: any) => String(p.currency_code).toLowerCase()
      )
      expect(currencies).toContain("usd")
    })
  })
})
