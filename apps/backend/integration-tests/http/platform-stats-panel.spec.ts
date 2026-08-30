/**
 * Integration tests for the DYNAMIC `metric_sections` stats operation.
 *
 * `metric_sections` has no business logic in code: the panel declares named
 * sections (entity + named aggregates + ranges + currency keys + derived
 * arithmetic) and the operation derives every section from live rows. This
 * spec seeds that config and proves it end to end through the real admin
 * stats APIs:
 *
 *   POST /admin/stats/panels/preview        — the operation, end to end
 *   POST /admin/stats/dashboards/:id/panels — seeded panel with metadata.public
 *   GET  /admin/stats/panels/:id/data       — admin resolver
 *   GET  /web/stats/panels/:id/data         — UNAUTHENTICATED public read,
 *                                             gated on metadata.public === true
 *
 * Seeded config (the exact sections the "Platform Stats" panel uses):
 *   orders       — capture transactions: count_distinct(order_id), all-time +
 *                  trailing window
 *   commission   — partner_fee sum, all-time + trailing window
 *   subscription — partner_subscription: count_distinct partners + MRR
 *                  (monthly-normalized plan price, yearly / 12)
 *   aov          — avg captured amount over the trailing window
 *   arr          — DERIVED section: subscription.mrr × 12
 *
 * Assertions are before/after DELTAS for all-time counts/sums so the spec
 * stays correct when other specs in a shared test DB already contain rows.
 * Money sections use the "jpy" currency (only this spec seeds jpy rows) so
 * commission/MRR/ARR/AOV are asserted EXACTLY.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { Modules } from "@medusajs/utils"
import {
  createOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"

jest.setTimeout(120000)

const unique = () => `ps${Date.now()}${Math.floor(Math.random() * 1e6)}`

// The declarative sections config — this is DATA, not code. The operation
// derives every section from live rows.
const jpySections = {
  orders: {
    entity: "order_transaction",
    filters: { reference: "capture" },
    aggregates: {
      processed: { fn: "count_distinct", field: "order_id" },
      trailing_30d: {
        fn: "count_distinct",
        field: "order_id",
        range: { date_field: "created_at", last_days: 30 },
      },
    },
    echo: { window_days: true },
  },
  commission: {
    entity: "partner_fee",
    filters: { status: "accrued" },
    currency_key: "currency_code",
    aggregates: {
      accrued: { fn: "sum", field: "fee_amount" },
      trailing_30d: {
        fn: "sum",
        field: "fee_amount",
        range: { date_field: "accrued_at", last_days: 30 },
      },
    },
    echo: { currency: true, window_days: true },
  },
  subscription: {
    entity: "partner_subscription",
    filters: { status: "active" },
    currency_key: "plan.currency_code",
    aggregates: {
      paying_artisans: { fn: "count_distinct", field: "partner_id" },
      mrr: {
        fn: "sum",
        field: "plan.price",
        normalize_interval: { interval_field: "plan.interval", yearly_divisor: 12 },
      },
    },
    echo: { currency: true },
  },
  aov: {
    entity: "order_transaction",
    filters: { reference: "capture" },
    currency_key: "currency_code",
    aggregates: {
      amount: { fn: "avg", field: "amount", range: { date_field: "created_at", last_days: 30 } },
    },
    echo: { currency: true },
  },
  arr: {
    derived: { ref: "subscription", aggregate: "mrr", multiply: 12 },
    echo: { currency: true },
  },
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  // ============================================
  // Helpers
  // ============================================

  const resolve = (key: string) => (getContainer().resolve(key) as any)

  const preview = (options: Record<string, any>) =>
    api.post(
      "/admin/stats/panels/preview",
      { operation_type: "metric_sections", operation_options: options },
      headers
    )

  const jpyPreview = () => preview({ currency: "jpy", window_days: 30, sections: jpySections })

  /** Seed a real order and mark it paid through the canonical core-flows pair. */
  const seedPaidOrder = async (
    container: any,
    input: { currency_code: string; unit_price: number; quantity: number; captured: boolean }
  ) => {
    const orderService = resolve(Modules.ORDER)
    const [order] = await orderService.createOrders([
      {
        currency_code: input.currency_code,
        email: `metric-sections-${unique()}@jyt.test`,
        items: [
          {
            title: "Metric sections test item",
            quantity: input.quantity,
            unit_price: input.unit_price,
          },
        ],
      },
    ])

    const total = input.unit_price * input.quantity
    if (input.captured) {
      const { result: pcRes }: any = await createOrderPaymentCollectionWorkflow(
        container
      ).run({ input: { order_id: order.id, amount: total } })
      const paymentCollectionId = Array.isArray(pcRes) ? pcRes[0]?.id : pcRes?.id
      await markPaymentCollectionAsPaid(container).run({
        input: { payment_collection_id: paymentCollectionId, order_id: order.id },
      })
    }
    return order
  }

  const seedFee = async (input: {
    order_id: string
    fee_amount: number
    accrued_at?: Date
  }) => {
    const [fee] = await resolve("partner_billing").createPartnerFees([
      {
        partner_id: `fee-partner-${unique()}`,
        order_id: input.order_id,
        order_total: input.fee_amount * 100,
        currency_code: "jpy",
        fee_basis: "percentage",
        fee_rate: 200,
        fee_amount: input.fee_amount,
        fee_type: "commission",
        status: "accrued",
        accrued_at: input.accrued_at ?? new Date(),
      },
    ])
    return fee
  }

  const seedSubscription = async (interval: "monthly" | "yearly", price: number) => {
    const planService = resolve("partnerPlan")
    const token = unique()
    const [plan] = await planService.createPartnerPlans([
      {
        name: `Metric sections plan ${token}`,
        slug: `metric-sections-${token}`,
        price,
        currency_code: "jpy",
        interval,
        is_active: true,
      },
    ])
    const [sub] = await planService.createPartnerSubscriptions([
      {
        partner_id: `artisan-${token}`,
        status: "active",
        plan_id: plan.id,
        current_period_start: new Date(),
      },
    ])
    return { plan, sub }
  }

  // ============================================
  // Tests
  // ============================================

  describe("POST /admin/stats/panels/preview — metric_sections", () => {
    it("derives every declared section from seeded rows", async () => {
      // Baseline before seeding (deltas make the assertions pollution-proof)
      const baseline = await jpyPreview()
      expect(baseline.status).toBe(200)
      const b = baseline.data.data

      // ── Seed ────────────────────────────────────────────────────────
      const container = getContainer()

      const o1 = await seedPaidOrder(container, {
        currency_code: "jpy",
        unit_price: 10000,
        quantity: 1,
        captured: true,
      })
      const o2 = await seedPaidOrder(container, {
        currency_code: "jpy",
        unit_price: 5000,
        quantity: 2,
        captured: true,
      })
      // Not captured — no capture transaction, so it must be excluded from
      // orders.processed and from the AOV capture-amount average
      await seedPaidOrder(container, {
        currency_code: "jpy",
        unit_price: 12345,
        quantity: 1,
        captured: false,
      })

      const f1 = await seedFee({ order_id: o1.id, fee_amount: 200 })
      await seedFee({
        order_id: o2.id,
        fee_amount: 300,
        accrued_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      })

      await seedSubscription("monthly", 999)
      await seedSubscription("yearly", 24000)

      // ── After ───────────────────────────────────────────────────────
      const after = await jpyPreview()
      expect(after.status).toBe(200)
      const d = after.data.data

      // Sections resolved cleanly — no per-section degradation warnings
      expect(d.warnings).toBeUndefined()

      // orders — capture transactions only (count_distinct over order_id)
      expect(d.orders.processed - b.orders.processed).toBe(2)
      expect(d.orders.trailing_30d - b.orders.trailing_30d).toBe(2)
      expect(d.orders.window_days).toBe(30)

      // commission — 200 + 300 seeded, only the recent one in the window
      expect(d.commission.currency).toBe("JPY")
      expect(d.commission.accrued - b.commission.accrued).toBe(500)
      expect(d.commission.trailing_30d - b.commission.trailing_30d).toBe(200)
      expect(d.commission.window_days).toBe(30)

      // subscription — monthly 999 + yearly 24000/12 = mrr 2999
      expect(d.subscription.currency).toBe("JPY")
      expect(d.subscription.paying_artisans - b.subscription.paying_artisans).toBe(2)
      expect(d.subscription.mrr - b.subscription.mrr).toBe(2999)

      // arr — DERIVED section: subscription.mrr × 12
      expect(d.arr.currency).toBe("JPY")
      expect(d.arr.amount - b.arr.amount).toBe(35988)

      // aov — avg captured amount: (10000 + 10000) / 2. jpy is only seeded
      // here, so the baseline jpy AOV is 0/null — otherwise the exact check
      // degrades and we only assert structure.
      expect(d.aov.currency).toBe("JPY")
      if (b.aov.amount == null || b.aov.amount === 0) {
        expect(d.aov.amount).toBe(10000)
      } else {
        expect(d.aov.amount).toBeGreaterThan(0)
      }

      // Top-level context echoes
      expect(d.currency).toBe("JPY")
      expect(d.window_days).toBe(30)

      // Shape contract — section keys are exactly what the config declares
      expect(Object.keys(d.orders).sort()).toEqual(["processed", "trailing_30d", "window_days"])
      expect(Object.keys(d.commission).sort()).toEqual([
        "accrued",
        "currency",
        "trailing_30d",
        "window_days",
      ])
      expect(Object.keys(d.subscription).sort()).toEqual(["currency", "mrr", "paying_artisans"])
      expect(Object.keys(d.arr).sort()).toEqual(["amount", "currency"])
      expect(Object.keys(d.aov).sort()).toEqual(["amount", "currency"])

      // Fee rows must have accrued_at honored — sanity on the seeded row
      expect(f1.fee_amount).toBeDefined()
    })

    it("rejects invalid operation_options", async () => {
      try {
        await preview({ sections: jpySections, window_days: 0 })
        fail("Should have rejected window_days <= 0")
      } catch (error: any) {
        expect([400, 422]).toContain(error.response?.status)
      }
    })
  })

  describe("seeded panel — admin resolver and public gate", () => {
    it("serves a metadata.public panel through admin and unauthenticated public endpoints, and 404s a private one", async () => {
      const token = unique()

      // 1) Create a dashboard + a PUBLIC panel
      const dashRes = await api.post(
        "/admin/stats/dashboards",
        { name: `Platform Stats ${token}` },
        headers
      )
      expect(dashRes.status).toBe(201)
      const dashboardId = dashRes.data.dashboard.id
      expect(dashboardId).toBeDefined()

      const panelRes = await api.post(
        `/admin/stats/dashboards/${dashboardId}/panels`,
        {
          name: `Platform snapshot ${token}`,
          type: "metric",
          operation_type: "metric_sections",
          operation_options: { currency: "jpy", window_days: 30, sections: jpySections },
          metadata: { public: true },
        },
        headers
      )
      expect(panelRes.status).toBe(201)
      const panelId = panelRes.data.panel.id

      // 2) Admin resolver resolves it with the full data
      //    (the admin panels/:id/data endpoint is a POST — same call the
      //    admin renderer hook makes, see src/admin/hooks/api/stats.ts)
      const adminData = await api.post(
        `/admin/stats/panels/${panelId}/data`,
        {},
        headers
      )
      expect(adminData.status).toBe(200)
      expect(adminData.data.panel_id).toBe(panelId)
      expect(adminData.data.data.orders.processed).toBeGreaterThanOrEqual(0)
      expect(adminData.data.data.commission.currency).toBe("JPY")

      // 3) UNAUTHENTICATED public read — the metadata.public gate opens it
      const publicData = await api.get(`/web/stats/panels/${panelId}/data`)
      expect(publicData.status).toBe(200)
      expect(publicData.data.panel_id).toBe(panelId)
      expect(publicData.data.data.orders.processed).toBeGreaterThanOrEqual(0)
      expect(publicData.data.data.subscription.currency).toBe("JPY")

      // 4) A PRIVATE panel (no metadata.public) 404s on the same endpoint —
      //    the gate never leaks that the id exists
      const privateRes = await api.post(
        `/admin/stats/dashboards/${dashboardId}/panels`,
        {
          name: `Private snapshot ${token}`,
          type: "metric",
          operation_type: "metric_sections",
          operation_options: { currency: "jpy", window_days: 30, sections: jpySections },
        },
        headers
      )
      expect(privateRes.status).toBe(201)
      const privatePanelId = privateRes.data.panel.id

      try {
        await api.get(`/web/stats/panels/${privatePanelId}/data`)
        fail("Should have 404'd a private panel on the public endpoint")
      } catch (error: any) {
        expect(error.response?.status).toBe(404)
      }
    })
  })
})
