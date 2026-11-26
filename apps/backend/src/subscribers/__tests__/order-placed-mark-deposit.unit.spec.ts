import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))

const deliverDepositReceivedEmail = jest.fn(async () => ({ sent: true, reason: null }))
jest.mock("../../workflows/designs/deliver-deposit-received-email", () => ({
  deliverDepositReceivedEmail: (...a: any[]) => (deliverDepositReceivedEmail as any)(...a),
}))

import markDepositPaidOnOrderPlaced from "../order-placed-mark-deposit"

/**
 * A MANUAL deposit was set before tax was known (Cherry: ₹8,000 pre-GST, ₹800
 * stored). On placement the schedule is re-based on the order, so the balance
 * it later asks for is exactly what the order reports outstanding.
 */
const containerWith = (schedule: any, order: any) => {
  const schedules = {
    findByCartId: jest.fn(async () => schedule),
    attachOrder: jest.fn(async () => undefined),
    markDepositPaid: jest.fn(async () => undefined),
    updatePaymentSchedules: jest.fn(async () => undefined),
  }
  const query = {
    graph: jest.fn(async ({ entity }: any) =>
      entity === "order_cart"
        ? { data: [{ order_id: "order_1", cart_id: "cart_1" }] }
        : { data: [order] }
    ),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === "payment_schedule") return schedules
      throw new Error(`unexpected resolve(${key})`)
    },
  }
  return { container, schedules, logger }
}

const run = (container: any) =>
  markDepositPaidOnOrderPlaced({ event: { data: { id: "order_1" } }, container } as any)

describe("order.placed — re-basing a manual deposit on the real order", () => {
  const manual = {
    id: "sched_1",
    source_type: "manual",
    deposit_status: "pending",
    order_id: null,
    deposit_pct: 10,
    total_due: 8000,
    deposit_amount: 800,
    balance_amount: 7200,
  }

  it("takes the total from the order and the deposit from what checkout collected", async () => {
    const { container, schedules } = containerWith(manual, {
      id: "order_1",
      total: 8400,
      payment_collections: [{ amount: 840 }],
    })
    await run(container)
    expect(schedules.updatePaymentSchedules).toHaveBeenCalledWith({
      id: "sched_1",
      total_due: 8400,
      deposit_amount: 840,
      balance_amount: 7560,
    })
    expect(schedules.markDepositPaid).toHaveBeenCalledWith("sched_1", "order_1")
  })

  it("leaves a QUOTE schedule's agreed figures alone", async () => {
    const { container, schedules } = containerWith(
      { ...manual, source_type: "quote" },
      { id: "order_1", total: 8400, payment_collections: [{ amount: 840 }] }
    )
    await run(container)
    expect(schedules.updatePaymentSchedules).not.toHaveBeenCalled()
    expect(schedules.markDepositPaid).toHaveBeenCalled()
  })

  it("does not re-base on figures that cannot be right", async () => {
    const { container, schedules } = containerWith(manual, {
      id: "order_1",
      total: 8400,
      payment_collections: [],
    })
    await run(container)
    expect(schedules.updatePaymentSchedules).not.toHaveBeenCalled()
  })
})

describe("#2568 deposit-received email", () => {
  beforeEach(() => deliverDepositReceivedEmail.mockClear())
  const manual = {
    id: "sched_1",
    source_type: "manual",
    deposit_status: "pending",
    order_id: null,
    deposit_pct: 10,
    total_due: 8000,
    deposit_amount: 800,
    balance_amount: 7200,
  }

  it("emails the RE-BASED figures once the deposit is marked paid", async () => {
    const { container } = containerWith(manual, {
      id: "order_1",
      total: 8400,
      payment_collections: [{ amount: 840 }],
    })
    await run(container)
    expect(deliverDepositReceivedEmail).toHaveBeenCalledTimes(1)
    expect((deliverDepositReceivedEmail.mock.calls[0] as any)[1]).toEqual({
      orderId: "order_1",
      depositAmount: 840,
      total: 8400,
      balanceAmount: 7560,
    })
  })

  it("does not email again on a redelivered event (deposit already paid)", async () => {
    const { container } = containerWith({ ...manual, deposit_status: "paid", order_id: "order_1" }, {
      id: "order_1",
      total: 8400,
      payment_collections: [{ amount: 840 }],
    })
    await run(container)
    expect(deliverDepositReceivedEmail).not.toHaveBeenCalled()
  })

  it("does not email a quote's buyer", async () => {
    const { container } = containerWith({ ...manual, source_type: "quote" }, {
      id: "order_1",
      total: 8400,
      payment_collections: [{ amount: 840 }],
    })
    await run(container)
    expect(deliverDepositReceivedEmail).not.toHaveBeenCalled()
  })
})

/**
 * #176 / #2645 — a 50% deposit charged IN FULL (195 AUD, not 97.50). The
 * re-base used to write 195 in as "the deposit" and balance 0, hiding it.
 */
describe("#2645 — a collection that is not the planned deposit is flagged, not re-based", () => {
  beforeEach(() => deliverDepositReceivedEmail.mockClear())
  const rune = {
    id: "sched_176",
    source_type: "manual",
    deposit_status: "pending",
    order_id: null,
    currency_code: "aud",
    deposit_pct: 50,
    total_due: 195,
    deposit_amount: 97.5,
    balance_amount: 97.5,
  }

  it("OVERCHARGE: keeps the planned split, still marks the deposit paid, alerts, emails nobody", async () => {
    const { container, schedules, logger } = containerWith(rune, {
      id: "order_1",
      total: 195,
      currency_code: "aud",
      payment_collections: [{ amount: 195 }],
    })
    await run(container)
    expect(schedules.updatePaymentSchedules).toHaveBeenCalledWith({
      id: "sched_176",
      total_due: 195,
      deposit_amount: 97.5,
      balance_amount: 97.5,
    })
    // Never the collected figure as the deposit.
    expect(schedules.updatePaymentSchedules).not.toHaveBeenCalledWith(
      expect.objectContaining({ deposit_amount: 195 })
    )
    expect(schedules.markDepositPaid).toHaveBeenCalledWith("sched_176", "order_1")
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[deposit] OVERCHARGE"))
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("overcharged by 97.5 AUD"))
    expect(deliverDepositReceivedEmail).not.toHaveBeenCalled()
  })

  it("a FIXED deposit is compared against its amount", async () => {
    const { container, schedules, logger } = containerWith(
      { ...rune, deposit_pct: null, deposit_amount: 800, total_due: 8000, balance_amount: 7200 },
      { id: "order_1", total: 8400, payment_collections: [{ amount: 8400 }] }
    )
    await run(container)
    expect(schedules.updatePaymentSchedules).toHaveBeenCalledWith({
      id: "sched_176",
      total_due: 8400,
      deposit_amount: 800,
      balance_amount: 7600,
    })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("OVERCHARGE"))
  })

  it("UNDERCHARGE: flagged, re-based on what was collected so the buyer pays the total in sum", async () => {
    const { container, schedules, logger } = containerWith(rune, {
      id: "order_1",
      total: 195,
      payment_collections: [{ amount: 90 }],
    })
    await run(container)
    expect(schedules.updatePaymentSchedules).toHaveBeenCalledWith({
      id: "sched_176",
      total_due: 195,
      deposit_amount: 90,
      balance_amount: 105,
    })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("UNDERCHARGE"))
    expect(deliverDepositReceivedEmail).toHaveBeenCalledTimes(1)
  })

  it("a half-cent rounding difference is not a mismatch", async () => {
    // 10% of 287.049 = 28.7049 → collected 28.70.
    const { container, schedules, logger } = containerWith(
      { ...rune, deposit_pct: 10 },
      { id: "order_1", total: 287.049, payment_collections: [{ amount: 28.7 }] }
    )
    await run(container)
    expect(schedules.updatePaymentSchedules).toHaveBeenCalledWith({
      id: "sched_176",
      total_due: 287.049,
      deposit_amount: 28.7,
      balance_amount: 258.35,
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
