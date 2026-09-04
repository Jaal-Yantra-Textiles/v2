/**
 * #771 — the ADMIN edit path must emit the status-changed event.
 *
 * The sibling spec `status-changed-event.unit.spec.ts` tests
 * `buildStatusChangedEvent` in isolation, and passed happily for months while
 * this path never called it. A pure helper with tests and no caller is not a
 * feature — so these assert the wiring, on the mock's recorded calls.
 */
import { applyInventoryOrderFieldUpdate } from "../update-inventory-orders"
import { INVENTORY_ORDER_STATUS_CHANGED_EVENT } from "../update-inventory-order"
import { Modules } from "@medusajs/framework/utils"

const makeContainer = (opts: {
  currentStatus?: string
  updatedStatus?: string
  emitThrows?: boolean
}) => {
  const emit = jest.fn(async (_event: unknown) => undefined)
  const updateInventoryOrders = jest.fn(async (_args: unknown) => [
    { id: "io_1", status: opts.updatedStatus },
  ])
  const retrieveInventoryOrder = jest.fn(async (_id: string, _config?: unknown) => ({
    id: "io_1",
    status: opts.currentStatus,
  }))

  const container = {
    resolve: jest.fn((key: string) => {
      if (key === Modules.EVENT_BUS) {
        return { emit: opts.emitThrows ? jest.fn(async () => { throw new Error("bus down") }) : emit }
      }
      return { updateInventoryOrders, retrieveInventoryOrder }
    }),
  }
  return { container, emit, updateInventoryOrders, retrieveInventoryOrder }
}

describe("admin inventory-order edit emits status-changed (#771)", () => {
  it("emits when an admin moves the status", async () => {
    const { container, emit } = makeContainer({
      currentStatus: "Processing",
      updatedStatus: "Shipped",
    })

    await applyInventoryOrderFieldUpdate({ id: "io_1", data: { status: "Shipped" } }, container)

    expect(emit).toHaveBeenCalledTimes(1)
    const event = emit.mock.calls[0][0] as any
    expect(event.name).toBe(INVENTORY_ORDER_STATUS_CHANGED_EVENT)
    expect(event.data).toEqual({
      id: "io_1",
      previous_status: "Processing",
      status: "Shipped",
    })
  })

  it("stays silent on a metadata-only edit, and does not pay for the extra read", async () => {
    const { container, emit, retrieveInventoryOrder } = makeContainer({
      currentStatus: "Processing",
      updatedStatus: "Processing",
    })

    await applyInventoryOrderFieldUpdate(
      { id: "io_1", data: { metadata: { note: "hello" } } },
      container
    )

    expect(emit).not.toHaveBeenCalled()
    expect(retrieveInventoryOrder).not.toHaveBeenCalled()
  })

  it("stays silent when the status is written but did not actually move", async () => {
    const { container, emit } = makeContainer({
      currentStatus: "Shipped",
      updatedStatus: "Shipped",
    })

    await applyInventoryOrderFieldUpdate({ id: "io_1", data: { status: "Shipped" } }, container)

    expect(emit).not.toHaveBeenCalled()
  })

  it("still applies the update when the event bus is down", async () => {
    const { container, updateInventoryOrders } = makeContainer({
      currentStatus: "Pending",
      updatedStatus: "Processing",
      emitThrows: true,
    })

    await expect(
      applyInventoryOrderFieldUpdate({ id: "io_1", data: { status: "Processing" } }, container)
    ).resolves.toBeDefined()

    expect(updateInventoryOrders).toHaveBeenCalledTimes(1)
  })

  it("emits with a null previous status when the prior read fails", async () => {
    const { container, emit } = makeContainer({ updatedStatus: "Delivered" })
    const svc = { 
      updateInventoryOrders: jest.fn(async () => [{ id: "io_1", status: "Delivered" }]),
      retrieveInventoryOrder: jest.fn(async () => { throw new Error("gone") }),
    }
    container.resolve = jest.fn((key: string) =>
      key === Modules.EVENT_BUS ? { emit } : svc
    ) as any

    await applyInventoryOrderFieldUpdate({ id: "io_1", data: { status: "Delivered" } }, container)

    expect(emit).toHaveBeenCalledTimes(1)
    expect((emit.mock.calls[0][0] as any).data.previous_status).toBeNull()
  })
})
