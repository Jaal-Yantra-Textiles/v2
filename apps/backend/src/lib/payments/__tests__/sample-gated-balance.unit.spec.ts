jest.mock("@medusajs/core-flows", () => ({
  markPaymentCollectionAsPaid: jest.fn(),
}))

import { MedusaError } from "@medusajs/framework/utils"
import { markPaymentCollectionAsPaid } from "@medusajs/core-flows"

import { raisesBalanceOnDispatch } from "../balance-collection"
import { assertSampleDecisionAllowed } from "../order-sample-decision"
import {
  balanceLinkRef,
  scheduleIdFromLinkRef,
  settlePayuBalance,
} from "../payu-balance"
import { PAYMENT_SCHEDULE_MODULE } from "../../../modules/payment_schedule"

/**
 * A made-to-order deal whose balance is released by the buyer approving a
 * first sample — not by the goods shipping. The case: indigo handloom denim
 * woven by Shramdaan, 10% deposit, 90% on the sample (2026-10-09).
 */

describe("raisesBalanceOnDispatch", () => {
  it("raises on dispatch for a dispatch deal, and for a row written before the column", () => {
    expect(raisesBalanceOnDispatch({ balance_trigger: "dispatch" })).toBe(true)
    expect(raisesBalanceOnDispatch({ balance_trigger: null })).toBe(true)
    expect(raisesBalanceOnDispatch({})).toBe(true)
  })

  it("🔴 does NOT raise on dispatch when the sample releases the balance", () => {
    // The sample may be shipped as a fulfilment of the order. Raising then
    // asks for 90% before the buyer has agreed to anything.
    expect(raisesBalanceOnDispatch({ balance_trigger: "sample_approved" })).toBe(false)
    expect(raisesBalanceOnDispatch({ balance_trigger: "manual" })).toBe(false)
  })
})

describe("assertSampleDecisionAllowed", () => {
  const ok = {
    order_id: "order_1",
    schedule: { balance_trigger: "sample_approved", deposit_status: "paid" },
    run: { run_type: "sample", order_id: "order_1" },
    decision: "approved",
  }

  const typeOf = (fn: () => void): string | null => {
    try {
      fn()
      return null
    } catch (e: any) {
      return e instanceof MedusaError ? e.type : "other"
    }
  }

  it("allows a sample run on this order, on a sample-released deal", () => {
    expect(typeOf(() => assertSampleDecisionAllowed(ok))).toBeNull()
    expect(typeOf(() => assertSampleDecisionAllowed({ ...ok, decision: "rejected" }))).toBeNull()
  })

  it("refuses a deal released on dispatch", () => {
    expect(
      typeOf(() =>
        assertSampleDecisionAllowed({ ...ok, schedule: { balance_trigger: "dispatch" } })
      )
    ).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(
      typeOf(() => assertSampleDecisionAllowed({ ...ok, schedule: { balance_trigger: null } }))
    ).toBe(MedusaError.Types.NOT_ALLOWED)
  })

  it("refuses a production run, and a sample from another order", () => {
    expect(
      typeOf(() =>
        assertSampleDecisionAllowed({ ...ok, run: { run_type: "production", order_id: "order_1" } })
      )
    ).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(
      typeOf(() =>
        assertSampleDecisionAllowed({ ...ok, run: { run_type: "sample", order_id: "order_2" } })
      )
    ).toBe(MedusaError.Types.NOT_ALLOWED)
  })

  it("reports a missing schedule or run as not found, and a bad verdict as invalid", () => {
    expect(typeOf(() => assertSampleDecisionAllowed({ ...ok, schedule: null }))).toBe(
      MedusaError.Types.NOT_FOUND
    )
    expect(typeOf(() => assertSampleDecisionAllowed({ ...ok, run: null }))).toBe(
      MedusaError.Types.NOT_FOUND
    )
    expect(typeOf(() => assertSampleDecisionAllowed({ ...ok, decision: "maybe" }))).toBe(
      MedusaError.Types.INVALID_DATA
    )
  })
})

describe("PayU balance link reference", () => {
  it("round-trips a schedule id and ignores a cart id", () => {
    expect(scheduleIdFromLinkRef(balanceLinkRef("psch_1"))).toBe("psch_1")
    expect(scheduleIdFromLinkRef("cart_01ABC")).toBeNull()
    expect(scheduleIdFromLinkRef("balance:")).toBeNull()
    expect(scheduleIdFromLinkRef(undefined)).toBeNull()
  })
})

describe("settlePayuBalance", () => {
  const markPaid = markPaymentCollectionAsPaid as unknown as jest.Mock
  let schedule: any
  let markBalancePaid: jest.Mock
  let run: jest.Mock

  const scope = () => ({
    resolve: (key: string) => {
      if (key === PAYMENT_SCHEDULE_MODULE) {
        return {
          retrievePaymentSchedule: async () => schedule,
          markBalancePaid,
        }
      }
      if (key === "query") {
        return {
          graph: async () => ({
            data: [
              {
                id: "order_1",
                payment_collections: [
                  { id: "paycol_deposit", amount: 300, status: "completed" },
                  { id: "paycol_balance", amount: 2700, status: "not_paid" },
                ],
              },
            ],
          }),
        }
      }
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    },
  })

  beforeEach(() => {
    schedule = {
      id: "psch_1",
      order_id: "order_1",
      balance_amount: 2700,
      balance_status: "due",
    }
    markBalancePaid = jest.fn()
    run = jest.fn().mockResolvedValue({ result: {} })
    markPaid.mockReset()
    markPaid.mockReturnValue({ run })
  })

  it("🔴 records nothing when PayU does not confirm the payment", async () => {
    const out = await settlePayuBalance(scope(), "psch_1", { txnid: "t1" }, {
      verifyTransaction: async () => ({ paid: false, status: "failure", amount: 2700 } as any),
    })
    expect(out.settled).toBe(false)
    expect(out.reason).toBe("not_verified")
    expect(run).not.toHaveBeenCalled()
    expect(markBalancePaid).not.toHaveBeenCalled()
  })

  it("verifies against the BALANCE, captures the outstanding collection, then marks the schedule paid", async () => {
    const verify = jest.fn(async () => ({ paid: true, status: "success", amount: 2700 } as any))
    const out = await settlePayuBalance(scope(), "psch_1", { txnid: "t1" }, {
      verifyTransaction: verify,
    })
    expect(out.settled).toBe(true)
    expect(verify).toHaveBeenCalledWith("t1", 2700)
    // The balance collection, not the deposit's completed one.
    expect(run).toHaveBeenCalledWith({
      input: {
        order_id: "order_1",
        payment_collection_id: "paycol_balance",
        captured_by: "payu_link",
      },
    })
    expect(markBalancePaid).toHaveBeenCalledWith("psch_1", "t1")
  })

  it("falls back to the link's transactions by invoice when verify_payment does not know the txnid", async () => {
    schedule.metadata = { payu_balance_invoice: "inv123" }
    const byInvoice = jest.fn(async () => ({ paid: true, transaction_id: "403993715" }))
    const out = await settlePayuBalance(scope(), "psch_1", { txnid: "403993715" }, {
      verifyTransaction: async () => null,
      verifyInvoice: byInvoice,
    })
    expect(out.settled).toBe(true)
    expect(byInvoice).toHaveBeenCalledWith("inv123", 2700)
    expect(markBalancePaid).toHaveBeenCalled()
  })

  it("is idempotent on a balance already paid", async () => {
    schedule.balance_status = "paid"
    const out = await settlePayuBalance(scope(), "psch_1", { txnid: "t1" })
    expect(out).toMatchObject({ settled: true, reason: "already_paid" })
    expect(run).not.toHaveBeenCalled()
  })

  it("does not settle a balance nobody raised", async () => {
    schedule.balance_status = "not_due"
    const out = await settlePayuBalance(scope(), "psch_1", { txnid: "t1" }, {
      verifyTransaction: async () => ({ paid: true } as any),
    })
    expect(out).toMatchObject({ settled: false, reason: "balance_not_due" })
    expect(markBalancePaid).not.toHaveBeenCalled()
  })
})
