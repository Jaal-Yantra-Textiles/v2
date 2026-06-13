/**
 * #342 PR-D (Chunk 7 / H1) — concurrency locking on the unified order's
 * metadata read-modify-write.
 *
 * Every #342 mirror does retrieveOrder → spread metadata → updateOrders. Two
 * near-simultaneous transitions (e.g. a partner `/complete` racing the
 * `production-run-task-updated` auto-complete) both read the same snapshot, and
 * the later write clobbers the earlier one (a lost update on `partner_status`).
 * `withUnifiedOrderMetadataLock` serializes that RMW on the unified order id so
 * every writer of the same order contends on one lock.
 *
 * This proves the primitive directly: fire N concurrent RMW jobs that each
 * increment a metadata counter (with an await between read and write to force
 * interleaving). Locked → the counter reaches exactly N. As a control, the same
 * jobs WITHOUT the lock lose updates (final < N), proving the lock is what makes
 * the locked case correct (not just a fast machine).
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { withUnifiedOrderMetadataLock } from "../../src/workflows/inventory_orders/dual-write-unified-order"

jest.setTimeout(60000)

const CONCURRENCY = 8

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification locking (#342 PR-D / Chunk 7)", () => {
    let adminHeaders: any
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    const createRegion = async () => {
      const regionService: any = getContainer().resolve(Modules.REGION)
      const region = await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      return region.id
    }

    // Reuse the inventory dual-write to mint a real unified order, then read its
    // id off the order↔inventory_order link (Chunk 6 — the link is the pointer).
    const createUnifiedOrder = async (): Promise<string> => {
      const res = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 1, price: 100 },
          ],
          quantity: 1,
          total_price: 100,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            first_name: "JYT",
            address_1: "Mill Road 1",
            city: "Jaipur",
            country_code: "in",
            postal_code: "302001",
          },
          stock_location_id: stockLocationId,
          from_stock_location_id: fromStockLocationId,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const legacyId = res.data.inventoryOrder.id

      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id: legacyId },
        fields: ["id", "order.id"],
      })
      const unifiedOrderId = data?.[0]?.order?.id
      expect(unifiedOrderId).toBeTruthy()
      return unifiedOrderId
    }

    const readCounter = async (unifiedOrderId: string): Promise<number> => {
      const orderService: any = getContainer().resolve(Modules.ORDER)
      const order = await orderService.retrieveOrder(unifiedOrderId, {
        select: ["id", "metadata"],
      })
      return Number(order?.metadata?.lock_test_counter ?? 0)
    }

    // One read-modify-write step: read the counter, await (forces interleaving),
    // then write counter+1 merged with existing metadata — the exact shape the
    // real mirrors use.
    const incrementCounter = async (unifiedOrderId: string) => {
      const orderService: any = getContainer().resolve(Modules.ORDER)
      const order = await orderService.retrieveOrder(unifiedOrderId, {
        select: ["id", "metadata"],
      })
      const next = Number(order?.metadata?.lock_test_counter ?? 0) + 1
      await sleep(15)
      await orderService.updateOrders([
        {
          id: unifiedOrderId,
          metadata: { ...(order?.metadata ?? {}), lock_test_counter: next },
        },
      ])
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await createRegion()

      const inventoryRes = await api.post(
        "/admin/inventory-items",
        { title: "Raw Cotton", sku: "RAW-COTTON-LOCK" },
        adminHeaders
      )
      expect(inventoryRes.status).toBe(200)
      inventoryItemId = inventoryRes.data.inventory_item.id

      const location = await api.post(
        "/admin/stock-locations",
        { name: "Lock Warehouse" },
        adminHeaders
      )
      stockLocationId = location.data.stock_location.id
      const fromLocation = await api.post(
        "/admin/stock-locations",
        { name: "Lock Warehouse Secondary" },
        adminHeaders
      )
      fromStockLocationId = fromLocation.data.stock_location.id
    })

    it("serializes concurrent metadata writes — no lost updates under the lock", async () => {
      const container = getContainer()
      const unifiedOrderId = await createUnifiedOrder()

      await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          withUnifiedOrderMetadataLock(container, unifiedOrderId, () =>
            incrementCounter(unifiedOrderId)
          )
        )
      )

      // Every increment landed: the lock made each RMW atomic.
      expect(await readCounter(unifiedOrderId)).toBe(CONCURRENCY)
    })

    it("loses updates WITHOUT the lock (control — proves the lock is load-bearing)", async () => {
      const unifiedOrderId = await createUnifiedOrder()

      // Same N concurrent RMW jobs, but unlocked: the awaited gap lets them all
      // read the same snapshot, so writes clobber each other.
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          incrementCounter(unifiedOrderId)
        )
      )

      expect(await readCounter(unifiedOrderId)).toBeLessThan(CONCURRENCY)
    })

    it("does not leak the lock — sequential writes still all land afterwards", async () => {
      const container = getContainer()
      const unifiedOrderId = await createUnifiedOrder()

      // A burst under the lock, then sequential writes: if execute() failed to
      // release, the next acquire would hang and time out.
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          withUnifiedOrderMetadataLock(container, unifiedOrderId, () =>
            incrementCounter(unifiedOrderId)
          )
        )
      )
      await withUnifiedOrderMetadataLock(container, unifiedOrderId, () =>
        incrementCounter(unifiedOrderId)
      )
      await withUnifiedOrderMetadataLock(container, unifiedOrderId, () =>
        incrementCounter(unifiedOrderId)
      )

      expect(await readCounter(unifiedOrderId)).toBe(CONCURRENCY + 2)
    })
  })
})
