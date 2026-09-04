const mockRun = jest.fn()

jest.mock("../../workflows/payments/request-order-balance", () => ({
  requestOrderBalanceWorkflow: () => ({ run: mockRun }),
}))

jest.mock("../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import raiseBalanceOnDispatch from "../order-dispatched-raise-balance"

/**
 * #1451 follow-on — raising the balance when the goods move.
 *
 * 🔴 The case that matters is the ID SHAPE. `order.fulfillment_created` carries
 * an order id; `shipment.created` and `delivery.created` carry a FULFILMENT id.
 * Treating the latter as an order id makes `findByOrderId` return nothing on
 * every shipment — the subscriber looks healthy and raises no balance at all.
 * These tests exist to stop that regressing quietly.
 */
const SCHEDULE = {
  id: "sched_1",
  order_id: "order_1",
  balance_status: "not_due",
  balance_amount: "220.34",
}

const build = (opts: { schedule?: any; fulfilmentOrderId?: string | null } = {}) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  // Typed with a parameter on purpose: a ZERO-arg `jest.fn` gives `mock.calls`
  // the type `[]`, and reading `calls[0][0]` is then TS2493 — green in jest,
  // red in `check:prod-build`, which compiles the specs.
  const emit = jest.fn(async (_payload: any) => undefined)
  // 🔴 `"schedule" in opts`, not `opts.schedule ?? SCHEDULE` — `??` treats an
  // explicit `null` as "not provided" and hands back the default, so the
  // no-schedule case silently tested the happy path instead.
  const findByOrderId = jest.fn(async () =>
    "schedule" in opts ? opts.schedule : SCHEDULE
  )

  const graph = jest.fn(async (_args: any) => ({
    data:
      opts.fulfilmentOrderId === null
        ? []
        : [{ id: "ful_1", order: { id: opts.fulfilmentOrderId ?? "order_1" } }],
  }))

  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === Modules.EVENT_BUS) return { emit }
      if (key === "payment_schedule") return { findByOrderId }
      throw new Error(`unexpected resolve(${key})`)
    },
  }

  return { container, logger, emit, findByOrderId, graph }
}

beforeEach(() => {
  mockRun.mockReset()
  mockRun.mockResolvedValue({
    result: {
      raised: true,
      pay_url: "https://v3.jaalyantra.com/stripe/pay/balance/sched_1",
      plan: {
        collectable: true,
        schedule_id: "sched_1",
        amount: 220.34,
        currency_code: "aud",
      },
    },
  })
})

describe("raiseBalanceOnDispatch", () => {
  it("🔴 resolves the ORDER from a fulfilment id on delivery.created", async () => {
    const { container, findByOrderId, graph } = build()

    await raiseBalanceOnDispatch({
      event: { name: "delivery.created", data: { id: "ful_1" } },
      container,
    } as any)

    // The fulfilment was looked up...
    expect(graph).toHaveBeenCalled()
    expect(graph.mock.calls[0][0]).toMatchObject({ entity: "fulfillment" })
    // ...and the ORDER id — never the fulfilment id — reached the schedule.
    expect(findByOrderId).toHaveBeenCalledWith("order_1")
    expect(mockRun).toHaveBeenCalledWith({
      input: { order_id: "order_1", requested_by: "dispatch" },
    })
  })

  it("takes the order id directly on order.fulfillment_created", async () => {
    const { container, findByOrderId, graph } = build()

    await raiseBalanceOnDispatch({
      event: { name: "order.fulfillment_created", data: { id: "order_1" } },
      container,
    } as any)

    // No fulfilment lookup needed — the payload already names the order.
    expect(graph).not.toHaveBeenCalled()
    expect(findByOrderId).toHaveBeenCalledWith("order_1")
  })

  it("emits order.balance_due carrying the amount AND the pay link", async () => {
    const { container, emit } = build()

    await raiseBalanceOnDispatch({
      event: { name: "shipment.created", data: { id: "ful_1" } },
      container,
    } as any)

    expect(emit).toHaveBeenCalledTimes(1)
    const payload = emit.mock.calls[0][0] as any
    expect(payload.name).toBe("order.balance_due")
    // A reminder without the link is a demand with no way to pay.
    expect(payload.data.pay_url).toMatch(/stripe\/pay\/balance\/sched_1/)
    expect(payload.data.amount).toBe(220.34)
    expect(payload.data.order_id).toBe("order_1")
  })

  it("does nothing for an order with no payment schedule", async () => {
    const { container, emit } = build({ schedule: null })

    await raiseBalanceOnDispatch({
      event: { name: "shipment.created", data: { id: "ful_1" } },
      container,
    } as any)

    // Fires on every shipment on the platform; silence is the correct
    // behaviour for an ordinary order.
    expect(mockRun).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("does not re-raise a balance that is already due or paid", async () => {
    for (const status of ["due", "paid", "waived"]) {
      mockRun.mockClear()
      const { container } = build({ schedule: { ...SCHEDULE, balance_status: status } })

      await raiseBalanceOnDispatch({
        event: { name: "shipment.created", data: { id: "ful_1" } },
        container,
      } as any)

      expect(mockRun).not.toHaveBeenCalled()
    }
  })

  it("🔴 never throws — a fulfilment must not fail because billing did", async () => {
    mockRun.mockRejectedValue(new Error("stripe exploded"))
    const { container, logger } = build()

    await expect(
      raiseBalanceOnDispatch({
        event: { name: "shipment.created", data: { id: "ful_1" } },
        container,
      } as any)
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalled()
  })

  it("gives up quietly when the fulfilment resolves to no order", async () => {
    const { container, findByOrderId } = build({ fulfilmentOrderId: null })

    await raiseBalanceOnDispatch({
      event: { name: "delivery.created", data: { id: "ful_unknown" } },
      container,
    } as any)

    expect(findByOrderId).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
  })
})
