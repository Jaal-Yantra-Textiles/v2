import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { mintBody, setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import raiseBalanceOnDispatch from "../../src/subscribers/order-dispatched-raise-balance"
import { appendFileSync } from "fs"
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
     * so CI never calls PayU. Run it with the PAYU_* test credentials inline.
     *
     * The WHOLE deal over PayU, nothing injected:
     *   deposit link (10%) → paid → link webhook completes the cart into an
     *   order → sample rejected (asks for nothing) → second sample approved →
     *   balance link (90%) → paid → link webhook settles → order owes 0.
     *
     * Each link is printed and appended to PAYU_E2E_OUT; the test waits up to
     * 15 minutes for each to be paid with a PayU test instrument.
     */
    const liveIt = process.env.PAYU_LIVE_E2E === "1" ? it : it.skip
    describe("live PayU test environment", () => {
      const out = (line: string) => {
        console.log(line)
        if (process.env.PAYU_E2E_OUT) appendFileSync(process.env.PAYU_E2E_OUT, line + "\n")
      }

      /** Ask PayU, every 10 s for up to 15 min, whether this link was paid. */
      const waitUntilPaid = async (invoice: string, amount: number) => {
        for (let i = 0; i < 90; i++) {
          const r = await verifyBalanceLinkViaOneApi(invoice, amount)
          if (r?.paid) return r
          await new Promise((res) => setTimeout(res, 10_000))
        }
        throw new Error(`PayU link ${invoice} was not paid within 15 minutes`)
      }

      /**
       * Deliver a link webhook to THIS server, form-encoded, with the fields
       * PayU's own webhook carries: the merchant `txnid` AND PayU's `mihpayid`.
       * The cart rail's provider authorises on `mihpayid` when the classic
       * verify cannot confirm the txnid — leaving it out failed the deposit
       * with "Session … was not authorized with the provider".
       */
      const postLinkWebhook = (
        udf1: string,
        paid: { transaction_id: string | null; payment_id: string | null },
        amount: number
      ) =>
        getSharedTestEnv().api.post(
          "/webhooks/payu/link",
          new URLSearchParams({
            status: "success",
            udf1,
            txnid: paid.transaction_id ?? "",
            mihpayid: paid.payment_id ?? "",
            amount: String(amount),
            mode: "CC",
          }).toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        )

      liveIt(
        "10% deposit, a rejected sample, an approved sample and the final payment, all over PayU",
        async () => {
          const { api } = getSharedTestEnv()
          const query: any = container().resolve(ContainerRegistrationKeys.QUERY)

          // ── 1. Quote: 10% deposit, balance on sample approval ──────────
          const minted = (
            await api.post(
              "/partners/quotes",
              mintBody(seed, {
                buyer_email: `live-${seed.unique}-${Date.now()}@jaalyantra.test`,
                deposit_pct: 10,
                balance_trigger: "sample_approved",
                lines: [{ variant_id: seed.variantA.id, quantity: 1 }],
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
          const cartId = accepted.data.acceptance.cart_id
          const opened = await schedules().findByCartId(cartId)
          const deposit = Number(opened.deposit_amount)
          const totalDue = Number(opened.total_due)
          expect(Number(opened.deposit_pct)).toBe(10)

          // ── 2. Deposit over a PayU link — for the DEPOSIT, not the total ─
          const link = await api.post(
            "/store/payu/payment-link",
            { cart_id: cartId },
            { headers: storeHeaders }
          )
          const depositUrl = link.data.payment_link
          const depositInvoice = link.data.invoice_number
          expect(depositUrl).toBeTruthy()
          expect(Number(link.data.total_amount ?? deposit)).toBeCloseTo(Math.round(deposit), 0)
          out(`DEPOSIT_LINK ${depositUrl} amount=${deposit} of total=${totalDue} invoice=${depositInvoice}`)

          const depositPaid = await waitUntilPaid(depositInvoice, deposit)
          out(`DEPOSIT_PAID txn=${depositPaid.transaction_id}`)

          const hook1 = await postLinkWebhook(cartId, depositPaid, deposit)
          expect(hook1.data.completed).toBe(true)
          const orderId = hook1.data.order_id
          expect(orderId).toBeTruthy()

          let sched: any = null
          for (let i = 0; i < 40; i++) {
            sched = await schedules().findByOrderId(orderId)
            if (sched?.deposit_status === "paid") break
            await new Promise((r) => setTimeout(r, 250))
          }
          expect(sched?.deposit_status).toBe("paid")
          expect(sched.balance_status).toBe("not_due")

          // The order now owes exactly the balance — the deposit was CAPTURED.
          const { data: o1 } = await query.graph({
            entity: "order",
            fields: ["id", "summary"],
            filters: { id: orderId },
          })
          const owedAfterDeposit = Number(o1[0].summary?.pending_difference)
          out(`ORDER ${orderId} owes ${owedAfterDeposit} after deposit (balance ${sched.balance_amount})`)
          expect(owedAfterDeposit).toBeCloseTo(Number(sched.balance_amount), 2)

          // ── 3. First sample REJECTED: nothing is asked for ──────────────
          const sample1 = await createRun(orderId, "sample")
          const rejected = await api.post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: sample1.id, decision: "rejected", notes: "Indigo too light" },
            adminHeaders
          )
          expect(rejected.data.sample_decision.balance_raised).toBe(false)
          expect((await schedules().findByOrderId(orderId)).balance_status).toBe("not_due")
          out(`SAMPLE_1 ${sample1.id} rejected — balance still not_due`)

          // ── 4. Second sample APPROVED: the balance is raised over PayU ──
          const sample2 = await createRun(orderId, "sample")
          const approved = await api.post(
            `/admin/orders/${orderId}/sample-approval`,
            { production_run_id: sample2.id, decision: "approved", confirm: true },
            adminHeaders
          )
          const balanceUrl: string = approved.data.sample_decision.pay_url
          expect(balanceUrl).not.toContain("/stripe/pay/balance")
          const due = await schedules().findByOrderId(orderId)
          expect(due.balance_status).toBe("due")
          expect(due.sample_run_id).toBe(sample2.id)
          expect(due.metadata?.sample_decisions?.map((d: any) => d.decision)).toEqual([
            "rejected",
            "approved",
          ])
          const balance = Number(due.balance_amount)
          const balanceInvoice = due.metadata?.payu_balance_invoice
          out(`BALANCE_LINK ${balanceUrl} amount=${balance} invoice=${balanceInvoice}`)

          // ── 5. Final payment ────────────────────────────────────────────
          const balancePaid = await waitUntilPaid(String(balanceInvoice), balance)
          out(`BALANCE_PAID txn=${balancePaid.transaction_id}`)
          const hook2 = await postLinkWebhook(`balance:${due.id}`, balancePaid, balance)
          expect(hook2.data.completed).toBe(true)

          const done = await schedules().findByOrderId(orderId)
          expect(done.deposit_status).toBe("paid")
          expect(done.balance_status).toBe("paid")
          const { data: o2 } = await query.graph({
            entity: "order",
            fields: ["id", "summary"],
            filters: { id: orderId },
          })
          const owedAtEnd = Number(o2[0].summary?.pending_difference)
          out(`DONE order ${orderId} owes ${owedAtEnd}; paid ${deposit} + ${balance} = ${deposit + balance} of ${totalDue}`)
          expect(owedAtEnd).toBeCloseTo(0, 2)
          expect(deposit + balance).toBeCloseTo(totalDue, 2)
        },
        35 * 60 * 1000
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
