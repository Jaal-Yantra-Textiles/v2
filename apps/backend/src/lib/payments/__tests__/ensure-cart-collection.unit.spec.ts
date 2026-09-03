import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const mockCoreRefresh = jest.fn(async () => ({ result: {} }))
const mockDeleteSessions = jest.fn(async () => ({ result: {} }))
const mockCreateCollectionForCart = jest.fn(async () => ({ result: { id: "pc_full" } }))

jest.mock("@medusajs/medusa/core-flows", () => ({
  createPaymentCollectionForCartWorkflow: () => ({ run: mockCreateCollectionForCart }),
  deletePaymentSessionsWorkflow: () => ({ run: mockDeleteSessions }),
  refreshPaymentCollectionForCartWorkflow: () => ({ run: mockCoreRefresh }),
}))

jest.mock("../../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))

import {
  ensureCartPaymentCollection,
  refreshCartPaymentCollection,
} from "../ensure-cart-collection"

/**
 * #1451 — the seam that decides what a buyer is charged, and the refresh trap
 * that would have silently undone it.
 */
const SCHEDULE = {
  id: "sched_1",
  deposit_amount: "1429.95",
  total_due: "4766.51",
  deposit_status: "pending",
  currency_code: "eur",
}

const scopeWith = (schedule: any) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const paymentService = {
    createPaymentCollections: jest.fn(async () => [{ id: "pc_deposit" }]),
  }
  const link = { create: jest.fn(async () => undefined) }
  const schedules = { findByCartId: jest.fn(async () => schedule) }
  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.LINK) return link
      if (key === Modules.PAYMENT) return paymentService
      if (key === "payment_schedule") return schedules
      throw new Error(`unexpected resolve(${key})`)
    },
  }
  return { scope, logger, paymentService, link, schedules }
}

const cart = (over: Record<string, unknown> = {}) => ({
  id: "cart_1",
  currency_code: "eur",
  total: 4766.51,
  ...over,
})

beforeEach(() => {
  mockCoreRefresh.mockClear()
  mockDeleteSessions.mockClear()
  mockCreateCollectionForCart.mockClear()
})

describe("ensureCartPaymentCollection", () => {
  it("creates the collection at the DEPOSIT amount and links it to the cart", async () => {
    const { scope, paymentService, link } = scopeWith(SCHEDULE)

    const { id, plan } = await ensureCartPaymentCollection(scope as any, cart())

    expect(id).toBe("pc_deposit")
    expect(plan.basis).toBe("deposit")
    // 🔴 The number a gateway will sign.
    expect(paymentService.createPaymentCollections).toHaveBeenCalledWith([
      { currency_code: "eur", amount: 1429.95 },
    ])
    // Core's full-total workflow must NOT have run — that is the defect.
    expect(mockCreateCollectionForCart).not.toHaveBeenCalled()
    // Without the link, `cart.payment_collection` never resolves and the next
    // request creates a SECOND collection.
    expect(link.create).toHaveBeenCalledTimes(1)
  })

  it("uses core's workflow untouched for an ordinary cart", async () => {
    const { scope, paymentService } = scopeWith(null)

    const { id, plan } = await ensureCartPaymentCollection(scope as any, cart())

    expect(id).toBe("pc_full")
    expect(plan.basis).toBe("full")
    expect(mockCreateCollectionForCart).toHaveBeenCalledTimes(1)
    expect(paymentService.createPaymentCollections).not.toHaveBeenCalled()
  })

  it("🔴 refuses to reuse a stale collection carrying the full total", async () => {
    // The three quote carts already on prod predate the deposit wiring.
    // Silently reusing one charges exactly the amount this change exists to stop.
    const { scope } = scopeWith(SCHEDULE)

    await expect(
      ensureCartPaymentCollection(
        scope as any,
        cart({ payment_collection: { id: "pc_old", amount: 4766.51 } })
      )
    ).rejects.toThrow(/4766.51[\s\S]*1429.95|1429.95/)
  })

  it("reuses an existing collection that already agrees with the deposit", async () => {
    const { scope, paymentService } = scopeWith(SCHEDULE)

    const { id } = await ensureCartPaymentCollection(
      scope as any,
      cart({ payment_collection: { id: "pc_dep", amount: 1429.95 } })
    )

    expect(id).toBe("pc_dep")
    expect(paymentService.createPaymentCollections).not.toHaveBeenCalled()
  })

  it("refuses an already-paid deposit rather than charging twice", async () => {
    const { scope } = scopeWith({ ...SCHEDULE, deposit_status: "paid" })

    await expect(
      ensureCartPaymentCollection(scope as any, cart())
    ).rejects.toThrow(/twice/i)
  })
})

describe("refreshCartPaymentCollection — the trap that would undo the fix", () => {
  /**
   * Core's refresh resets the collection to `amount: cart.raw_total` whenever
   * it differs from the cart total — which a deposit does BY DEFINITION. The
   * PayU rail refreshes on five paths, so without this the first attempt asks
   * for the deposit and every retry asks for 100%.
   */
  it("🔴 does NOT call core's refresh on a deposit cart", async () => {
    const { scope } = scopeWith(SCHEDULE)

    const { preserved_deposit } = await refreshCartPaymentCollection(
      scope as any,
      cart({
        payment_collection: {
          id: "pc_dep",
          amount: 1429.95,
          payment_sessions: [{ id: "ps_1" }, { id: "ps_2" }],
        },
      })
    )

    expect(preserved_deposit).toBe(true)
    expect(mockCoreRefresh).not.toHaveBeenCalled()
    // It still does the half that IS wanted: drop the stale sessions.
    expect(mockDeleteSessions).toHaveBeenCalledWith({
      input: { ids: ["ps_1", "ps_2"] },
    })
  })

  it("calls core's refresh for an ordinary cart", async () => {
    const { scope } = scopeWith(null)

    const { preserved_deposit } = await refreshCartPaymentCollection(
      scope as any,
      cart({ payment_collection: { id: "pc", amount: 4766.51, payment_sessions: [] } })
    )

    expect(preserved_deposit).toBe(false)
    expect(mockCoreRefresh).toHaveBeenCalledTimes(1)
    expect(mockDeleteSessions).not.toHaveBeenCalled()
  })

  it("does not throw on a refusal — refresh runs on retry paths, often inside a catch", async () => {
    const { scope } = scopeWith({ ...SCHEDULE, deposit_status: "paid" })

    // A throw here would turn a recoverable payment retry into a dead checkout.
    // The refusal is raised by ensureCartPaymentCollection instead, at the point
    // a charge is actually about to be created.
    await expect(
      refreshCartPaymentCollection(
        scope as any,
        cart({ payment_collection: { id: "pc", amount: 1429.95, payment_sessions: [] } })
      )
    ).resolves.toMatchObject({ preserved_deposit: false })
  })
})
