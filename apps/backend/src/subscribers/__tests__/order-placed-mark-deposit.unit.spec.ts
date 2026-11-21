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
  const logger = { info: jest.fn(), warn: jest.fn() }
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === "payment_schedule") return schedules
      throw new Error(`unexpected resolve(${key})`)
    },
  }
  return { container, schedules }
}

const run = (container: any) =>
  markDepositPaidOnOrderPlaced({ event: { data: { id: "order_1" } }, container } as any)

describe("order.placed — re-basing a manual deposit on the real order", () => {
  const manual = {
    id: "sched_1",
    source_type: "manual",
    deposit_status: "pending",
    order_id: null,
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
