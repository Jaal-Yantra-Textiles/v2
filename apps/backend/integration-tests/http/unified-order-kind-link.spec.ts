/**
 * #2029 item 4 — the order ↔ unified_order_kind sidecar, proven against a real
 * database.
 *
 * 🔑 Why integration. `defineLink` registers as an import side effect, and a
 * `query.graph` hop that names the wrong entry point or the wrong column comes
 * back EMPTY rather than throwing. Empty here is indistinguishable from "this
 * order has no kind row" — which `readIsCollated` deliberately treats as
 * "nobody has told me" and answers from the metadata blob. So a misspelt link
 * would look exactly like correct fallback behaviour, forever, and the typed
 * column would silently never be read.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/unified-order-kind-link
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  setUnifiedOrderKind,
  readIsCollated,
} from "../../src/workflows/inventory_orders/dual-write-unified-order"

jest.setTimeout(180_000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("order ↔ unified_order_kind sidecar (#2029 item 4)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    /** A bare order to hang the sidecar off. */
    const seedOrder = async (): Promise<string> => {
      const container = getContainer()
      const orderService: any = container.resolve("order")
      const created = await orderService.createOrders({
        region_id: null,
        currency_code: "inr",
        items: [],
      })
      const row = Array.isArray(created) ? created[0] : created
      return String(row.id)
    }

    /** Read the kind back the way every production reader does. */
    const readKindThroughGraph = async (orderId: string) => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "metadata", "unified_order_kind.kind"],
        filters: { id: orderId },
      })
      return data?.[0]
    }

    it("round-trips a collated kind through the link", async () => {
      const orderId = await seedOrder()
      await setUnifiedOrderKind(getContainer(), orderId, "collated")

      const row = await readKindThroughGraph(orderId)
      // 🔴 The load-bearing assertion: misspell the link's `field` or the
      // column and this is `undefined`, not an error.
      expect(row?.unified_order_kind?.kind).toBe("collated")
      expect(readIsCollated(row)).toBe(true)
    })

    it("round-trips per_run, and that beats a stale blob", async () => {
      const orderId = await seedOrder()
      const container = getContainer()
      const orderService: any = container.resolve("order")
      await orderService.updateOrders([
        { id: orderId, metadata: { collated_design_order: true } },
      ])

      await setUnifiedOrderKind(container, orderId, "per_run")

      const row = await readKindThroughGraph(orderId)
      expect(row?.unified_order_kind?.kind).toBe("per_run")
      expect(row?.metadata?.collated_design_order).toBe(true)
      // The typed row wins outright — that is the whole point of typing it.
      expect(readIsCollated(row)).toBe(false)
    })

    /**
     * The upsert half. A second write must MOVE the order's kind, not mint a
     * second row and leave the reader picking one at random — the promote path
     * (`joinRunsIntoWorkOrder`) writes `collated` onto an order that was
     * already `per_run`, so this is the ordinary case, not an edge one.
     */
    it("promotes per_run to collated in place, without a second row", async () => {
      const orderId = await seedOrder()
      const container = getContainer()

      await setUnifiedOrderKind(container, orderId, "per_run")
      const before = await readKindThroughGraph(orderId)
      expect(before?.unified_order_kind?.kind).toBe("per_run")

      await setUnifiedOrderKind(container, orderId, "collated")
      const after = await readKindThroughGraph(orderId)
      expect(after?.unified_order_kind?.kind).toBe("collated")

      const kindService: any = container.resolve("unified_order_kind")
      const rows = await kindService.listUnifiedOrderKinds({}, { take: null })
      const linked = (rows ?? []).filter(
        (r: any) => r.id === after?.unified_order_kind?.id
      )
      expect(linked.length).toBeLessThanOrEqual(1)
    })

    /**
     * An order nobody has told about keeps answering from the blob. This is
     * every order written before the sidecar existed, and getting it wrong
     * renders the single-design screen for a collated job.
     */
    it("an order with no kind row falls back to the blob", async () => {
      const orderId = await seedOrder()
      const container = getContainer()
      const orderService: any = container.resolve("order")
      await orderService.updateOrders([
        { id: orderId, metadata: { collated_design_order: true } },
      ])

      const row = await readKindThroughGraph(orderId)
      expect(row?.unified_order_kind ?? null).toBeFalsy()
      expect(readIsCollated(row)).toBe(true)
    })
  })
})
