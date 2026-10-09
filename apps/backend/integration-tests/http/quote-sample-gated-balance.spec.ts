import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { mintBody, setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import raiseBalanceOnDispatch from "../../src/subscribers/order-dispatched-raise-balance"
import { writeFileSync } from "fs"
import {
  settlePayuBalance,
  verifyBalanceLinkViaOneApi,
} from "../../src/lib/payments/payu-balance"

jest.setTimeout(300 * 1000)

/**
 * ⚠️ `medusaIntegrationTestRunner` restores the database to a snapshot (taken
 * after the `beforeAll`s) before EVERY test, so each `it` starts with the
 * order placed and the sample run created, and nothing a previous `it` did.
 *
 * A made-to-order deal: 10% deposit now, the balance when the buyer approves
 * a first sample (2026-10-09 — indigo handloom denim woven by Shramdaan).
 *
 * Driven end to end against a real container: mint with
 * `balance_trigger: sample_approved` → accept → pay the deposit and complete
 * the cart → a sample run on the order → a shipment does NOT ask for the
 * balance → a rejected sample asks for nothing → an approved sample raises it
 * → PayU confirms it and the order is settled.
 */
setupSharedTestSuite(() => {
  describe("balance released by sample approval", () => {
    let seed: QuoteFixture
    let adminHeaders: Record<string, any>
    let storeHeaders: Record<string, string>

    const container = () => getSharedTestEnv().getContainer()
    const schedules = () => container().resolve(PAYMENT_SCHEDULE_MODULE) as any

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
    })

    /** Mint, accept, pay the deposit and complete. Returns the order and its schedule. */
    const placedDepositOrder = async (overrides: Record<string, any>) => {
      const { api } = getSharedTestEnv()
      const minted = (
        await api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `sample-${seed.unique}-${Date.now()}@jaalyantra.test`,
            ...overrides,
          }),
          { headers: seed.headers }
        )
      ).data

      const accepted = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {
          shipping_address: {
            first_name: "Asha",
            last_name: "Buyer",
            address_1: "9 Marine Drive",
            city: "Mumbai",
            province: "MH",
            postal_code: "400001",
            country_code: "in",
            phone: "+919000000000",
          },
        },
        { headers: storeHeaders }
      )
      expect(accepted.status).toBe(201)
      const cartId = accepted.data.acceptance?.cart_id
      expect(cartId).toBeTruthy()

      const schedule = await schedules().findByCartId(cartId)
      expect(schedule).toBeTruthy()

      const payColl = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers: storeHeaders }
      )
      const collection = payColl.data.payment_collection
      // The deposit, not the total (#1451) — the premise of everything below.
      expect(Number(collection.amount)).toBeCloseTo(Number(schedule.deposit_amount), 2)

      const providers = (
        await api.get(`/store/payment-providers?region_id=${seed.regionId}`, {
          headers: storeHeaders,
        })
      ).data.payment_providers
      const provider = pickTestPaymentProvider(providers)
      await api.post(
        `/store/payment-collections/${collection.id}/payment-sessions`,
        { provider_id: provider!.id },
        { headers: storeHeaders }
      )

      const complete = await api.post(`/store/carts/${cartId}/complete`, {}, {
        headers: storeHeaders,
      })
      expect(complete.data.type).toBe("order")
      const orderId = complete.data.order.id

      /**
       * Capture the deposit. The test provider only AUTHORISES; PayU
       * (`auto_capture`) and Stripe (`capture: true`) capture on prod. Without
       * it the order still shows the whole total outstanding, and the balance
       * workflow rightly refuses a schedule that disagrees with the order.
       */
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data: paid } = await query.graph({
        entity: "order",
        fields: ["id", "payment_collections.payments.id"],
        filters: { id: orderId },
      })
      for (const pc of paid[0].payment_collections ?? []) {
        for (const p of pc.payments ?? []) {
          await api.post(`/admin/payments/${p.id}/capture`, {}, adminHeaders)
        }
      }

      // order.placed marks the deposit paid in a subscriber; wait for it.
      let after: any = null
      for (let i = 0; i < 40; i++) {
        after = await schedules().findByOrderId(orderId)
        if (after?.deposit_status === "paid") break
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(after?.deposit_status).toBe("paid")
      return { orderId, schedule: after }
    }

    const fireDispatch = (orderId: string) =>
      raiseBalanceOnDispatch({
        event: { name: "order.fulfillment_created", data: { id: orderId } },
        container: container(),
      } as any)

    const createRun = async (orderId: string, run_type: "sample" | "production") => {
      const runs: any = container().resolve(PRODUCTION_RUNS_MODULE)
      const created = await runs.createProductionRuns({
        run_type,
        order_id: orderId,
        partner_id: seed.partnerId,
        quantity: 1,
        snapshot: {},
        captured_at: new Date(),
      })
      return Array.isArray(created) ? created[0] : created
    }

    describe("a deal released by the sample", () => {
      let orderId: string
      let sampleRunId: string

      beforeAll(async () => {
        const placed = await placedDepositOrder({
          deposit_pct: 10,
          balance_trigger: "sample_approved",
        })
        orderId = placed.orderId
        expect(placed.schedule.balance_trigger).toBe("sample_approved")
        expect(Number(placed.schedule.deposit_pct)).toBe(10)
        expect(placed.schedule.rail).toBe("payu")
        sampleRunId = (await createRun(orderId, "sample")).id
      })

      it("🔴 a shipment does NOT ask for the balance", async () => {
        await fireDispatch(orderId)
        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("not_due")
      })

      it("refuses an approval without confirm, and a run that is not a sample", async () => {
        const { api } = getSharedTestEnv()
        const noConfirm = await api
          .post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: sampleRunId, decision: "approved" },
            adminHeaders
          )
          .catch((e: any) => e.response)
        expect(noConfirm.status).toBe(400)

        const production = await createRun(orderId, "production")
        const wrongRun = await api
          .post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: production.id, decision: "approved", confirm: true },
            adminHeaders
          )
          .catch((e: any) => e.response)
        expect(wrongRun.status).toBe(409)

        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("not_due")
      })

      it("a rejected sample is recorded and asks for nothing", async () => {
        const { api } = getSharedTestEnv()
        const res = await api.post(
          `/admin/orders/${orderId}/sample-approval`,
          { production_run_id: sampleRunId, decision: "rejected", notes: "Indigo too light" },
          adminHeaders
        )
        expect(res.status).toBe(200)
        expect(res.data.sample_decision.balance_raised).toBe(false)

        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("not_due")
        expect(s.sample_approved_at).toBeNull()
        expect(s.metadata?.sample_decisions?.[0]).toMatchObject({
          decision: "rejected",
          notes: "Indigo too light",
          production_run_id: sampleRunId,
        })
      })

      it("an approved sample raises the balance, once", async () => {
        const { api } = getSharedTestEnv()
        // The runner restores the DB before every test, so this test makes its
        // own history: a first sample rejected, a second approved.
        await api.post(
          `/admin/orders/${orderId}/sample-approval`,
          { production_run_id: sampleRunId, decision: "rejected", notes: "Indigo too light" },
          adminHeaders
        )
        const res = await api.post(
          `/admin/orders/${orderId}/sample-approval`,
          { production_run_id: sampleRunId, decision: "approved", confirm: true },
          adminHeaders
        )
        expect(res.status).toBe(200)
        const decision = res.data.sample_decision
        expect(decision.balance_raised).toBe(true)
        expect(decision.balance_status).toBe("due")
        // PayU is not configured under test, so the Stripe page is the fallback.
        expect(decision.pay_url).toBeTruthy()

        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("due")
        expect(s.sample_run_id).toBe(sampleRunId)
        expect(s.sample_approved_at).toBeTruthy()
        expect(s.metadata?.sample_decisions).toHaveLength(2)

        // Read the ORDER back: a second collection exists for exactly the balance.
        const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "order",
          fields: ["id", "payment_collections.id", "payment_collections.amount", "payment_collections.status"],
          filters: { id: orderId },
        })
        const open = (data[0].payment_collections ?? []).filter((c: any) => c.status !== "completed")
        expect(open).toHaveLength(1)
        expect(Number(open[0].amount)).toBeCloseTo(Number(s.balance_amount), 2)

        // Approving again returns the same link and makes no second collection.
        const again = await api.post(
          `/admin/orders/${orderId}/sample-approval`,
          { production_run_id: sampleRunId, decision: "approved", confirm: true },
          adminHeaders
        )
        expect(again.data.sample_decision.pay_url).toBe(decision.pay_url)
        const { data: d2 } = await query.graph({
          entity: "order",
          fields: ["id", "payment_collections.id", "payment_collections.status"],
          filters: { id: orderId },
        })
        expect(d2[0].payment_collections.filter((c: any) => c.status !== "completed")).toHaveLength(1)
      })

      it("a PayU-confirmed balance settles the order and the schedule", async () => {
        const { api } = getSharedTestEnv()
        await api.post(
          `/admin/orders/${orderId}/sample-approval`,
          { production_run_id: sampleRunId, decision: "approved", confirm: true },
          adminHeaders
        )
        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("due")

        // An unconfirmed payment changes nothing.
        const refused = await settlePayuBalance(container(), s.id, { txnid: "txn_fake" }, {
          verifyTransaction: async () => ({ paid: false, status: "failure" } as any),
        })
        expect(refused.settled).toBe(false)
        expect((await schedules().findByOrderId(orderId)).balance_status).toBe("due")

        const settled = await settlePayuBalance(container(), s.id, { txnid: "txn_ok" }, {
          verifyTransaction: async () => ({ paid: true, status: "success", amount: Number(s.balance_amount) } as any),
        })
        expect(settled.settled).toBe(true)

        const after = await schedules().findByOrderId(orderId)
        expect(after.balance_status).toBe("paid")

        const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "order",
          fields: ["id", "summary", "payment_collections.status"],
          filters: { id: orderId },
        })
        // Both halves received: nothing outstanding on the order.
        expect(Number(data[0].summary?.pending_difference)).toBeCloseTo(0, 2)
        expect(data[0].payment_collections.every((c: any) => c.status === "completed")).toBe(true)
      })
    })

    /**
     * 🔑 LIVE against PayU's TEST environment. Skipped unless PAYU_LIVE_E2E=1,
     * so CI never calls PayU. Run it with the PAYU_* test credentials inline:
     * it mints a REAL balance link, waits (up to 15 min) for someone to pay it
     * with a PayU test instrument, then delivers the link webhook to this
     * server, which re-verifies with PayU itself — nothing is injected.
     * The link is printed, and written to PAYU_E2E_OUT when that is set.
     */
    const liveIt = process.env.PAYU_LIVE_E2E === "1" ? it : it.skip
    describe("live PayU test environment", () => {
      liveIt(
        "an approved sample mints a real PayU balance link; paying it settles the order",
        async () => {
          const { api } = getSharedTestEnv()
          const { orderId } = await placedDepositOrder({
            deposit_pct: 10,
            balance_trigger: "sample_approved",
            lines: [{ variant_id: seed.variantA.id, quantity: 1 }],
          })
          const run = await createRun(orderId, "sample")

          const res = await api.post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: run.id, decision: "approved", confirm: true },
            adminHeaders
          )
          const payUrl: string = res.data.sample_decision.pay_url
          // A PayU link, not the Stripe fallback.
          expect(payUrl).not.toContain("/stripe/pay/balance")
          expect(payUrl).toMatch(/payu/i)

          const s = await schedules().findByOrderId(orderId)
          const invoice = s.metadata?.payu_balance_invoice
          expect(invoice).toBeTruthy()
          const balance = Number(s.balance_amount)
          const banner = `PAYU_BALANCE_LINK ${payUrl} invoice=${invoice} amount=${balance} schedule=${s.id}`
          console.log(banner)
          if (process.env.PAYU_E2E_OUT) writeFileSync(process.env.PAYU_E2E_OUT, banner + "\n")

          // Wait for the link to be paid, asking PayU itself.
          let paid: { paid: boolean; transaction_id: string | null } | null = null
          for (let i = 0; i < 90; i++) {
            paid = await verifyBalanceLinkViaOneApi(String(invoice), balance)
            if (paid?.paid) break
            await new Promise((r) => setTimeout(r, 10_000))
          }
          expect(paid?.paid).toBe(true)
          if (process.env.PAYU_E2E_OUT) {
            writeFileSync(process.env.PAYU_E2E_OUT, banner + `\nPAID txn=${paid?.transaction_id}\n`)
          }

          // Deliver the link webhook to THIS server. It verifies with PayU.
          // Form-encoded, as PayU posts it.
          const hook = await api.post(
            "/webhooks/payu/link",
            new URLSearchParams({
              status: "success",
              udf1: `balance:${s.id}`,
              txnid: paid?.transaction_id ?? "",
              amount: String(balance),
            }).toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          )
          expect(hook.data.completed).toBe(true)

          const after = await schedules().findByOrderId(orderId)
          expect(after.balance_status).toBe("paid")
          const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
          const { data } = await query.graph({
            entity: "order",
            fields: ["id", "summary"],
            filters: { id: orderId },
          })
          expect(Number(data[0].summary?.pending_difference)).toBeCloseTo(0, 2)
        },
        16 * 60 * 1000
      )
    })

    describe("a deal released on dispatch (unchanged)", () => {
      it("still asks for the balance when the goods ship", async () => {
        const { orderId, schedule } = await placedDepositOrder({ deposit_pct: 10 })
        expect(schedule.balance_trigger).toBe("dispatch")

        await fireDispatch(orderId)
        const s = await schedules().findByOrderId(orderId)
        expect(s.balance_status).toBe("due")
      })

      it("refuses a sample approval, because the sample does not release this deal", async () => {
        const { api } = getSharedTestEnv()
        const { orderId } = await placedDepositOrder({ deposit_pct: 10 })
        const run = await createRun(orderId, "sample")
        const res = await api
          .post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: run.id, decision: "approved", confirm: true },
            adminHeaders
          )
          .catch((e: any) => e.response)
        expect(res.status).toBe(409)
      })
    })
  })
})
