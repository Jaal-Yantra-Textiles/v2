/**
 * #2324 — a send-to-partner workflow that times out must not un-link a
 * FINISHED order from its partner.
 *
 * Prod: Unique Pashmina's order was received by admin and paid (₹14,000); the
 * workflow's `await-order-*` steps were never signalled, timed out after 23
 * days, and the compensation dismissed the partner link. The partner's portal
 * lost the order.
 *
 * The timeout is simulated with a PERMANENT step failure on the waiting step —
 * the same path a TransactionTimeout takes into the compensations. The control
 * case (an unfinished order) proves the failure really runs the compensation,
 * so the finished case cannot pass by the compensation simply not running.
 */
import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { relinkRolledBackInventoryOrderPartnersJob } from "../../src/api/admin/ops/maintenance-jobs/relink-rolled-back-inventory-order-partners-job"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(180000)

const PASSWORD = "supersecret"
const WORKFLOW_ID = "send-inventory-order-to-partner"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("send-to-partner rollback keeps finished orders linked (#2324)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    const makePartner = async (label: string) => {
      const email = `rollback-${label}-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const l1 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      const p = await post(
        "/partners",
        { name: `Rollback ${label} ${unique}`, handle: `rollback-${label}-${unique}`, admin: { email, first_name: "R", last_name: "B" } },
        { headers: { Authorization: `Bearer ${l1.data.token}` } }
      )
      const l2 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      return { id: p.data.partner.id as string, headers: { headers: { Authorization: `Bearer ${l2.data.token}` } } }
    }

    const makeOrder = async (qty: number) => {
      const location = (await post("/admin/stock-locations", { name: `Rollback WH ${unique}-${qty}` }, adminHeaders)).data
        .stock_location.id as string
      const item = (await post("/admin/inventory-items", { title: `Rollback Silk ${unique}-${qty}`, sku: `rb-${unique}-${qty}` }, adminHeaders))
        .data.inventory_item.id as string
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: item, quantity: qty, price: 100 }],
          quantity: qty,
          total_price: qty * 100,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: location,
        },
        adminHeaders
      )
      return res.data.inventoryOrder.id as string
    }

    const seedTemplates = async () => {
      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await post(
          "/admin/task-templates",
          {
            name,
            description: `${name} template`,
            priority: "medium",
            estimated_duration: 30,
            eventable: true,
            notifiable: true,
            metadata: { workflow_type: "partner_assignment" },
          },
          adminHeaders
        )
      }
    }

    const send = async (orderId: string, partnerId: string) => {
      const res = await post(`/admin/inventory-orders/${orderId}/send-to-partner`, { partnerId, notes: "#2324" }, adminHeaders)
      return res.data.transactionId as string
    }

    const setStatus = async (orderId: string, status: string) => {
      const svc: any = getContainer().resolve(ORDER_INVENTORY_MODULE)
      await svc.updateInventoryOrders({ id: orderId, status })
    }

    const linkedPartner = async (orderId: string): Promise<string | null> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "partner.id"],
        filters: { id: orderId },
      })
      const p = data?.[0]?.partner
      return (Array.isArray(p) ? p[0]?.id : p?.id) ?? null
    }

    const executionState = async (transactionId: string): Promise<string | null> => {
      const engine: any = getContainer().resolve(Modules.WORKFLOW_ENGINE)
      const rows = await engine.listWorkflowExecutions({ workflow_id: WORKFLOW_ID, transaction_id: transactionId })
      return rows?.[0]?.state ?? null
    }

    /** What a 23-day TransactionTimeout does: a permanent failure of the waiting step. */
    const timeOut = async (transactionId: string) => {
      const engine: any = getContainer().resolve(Modules.WORKFLOW_ENGINE)
      await engine
        .setStepFailure({
          idempotencyKey: {
            action: TransactionHandlerType.INVOKE,
            transactionId,
            stepId: "await-order-start",
            workflowId: WORKFLOW_ID,
          },
          stepResponse: new StepResponse("simulated await timeout"),
          options: { forcePermanentFailure: true, throwOnError: false },
        })
        .catch(() => undefined)
      // A finished execution with no retention is DELETED from the table, so
      // "no longer invoking" (row gone, or reverted/failed) is the end state.
      for (let i = 0; i < 40; i++) {
        const state = await executionState(transactionId)
        if (state !== "invoking") break
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    /**
     * The partner tasks' transaction ids. The `set-task-transaction-ids`
     * compensation (NOT guarded by #2324) clears them, so an empty list proves
     * the compensations ran; a list that still names the transaction proves
     * the workflow completed instead.
     */
    const taskTransactionIds = async (orderId: string): Promise<string[]> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "tasks.transaction_id"],
        filters: { id: orderId },
      })
      return ((data?.[0]?.tasks ?? []) as any[]).map((t) => t?.transaction_id).filter(Boolean)
    }

    const rollbackRows = async (orderId: string) => {
      const svc: any = getContainer().resolve(ORDER_INVENTORY_MODULE)
      return svc.listInventoryOrderActivities({ inventory_order_id: orderId, kind: "partner_link_rolled_back" })
    }

    beforeEach(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      await ensureHouseStoreRegion(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await seedTemplates()
    })

    it("CONTROL: a timed-out workflow on an unfinished order still un-links it", async () => {
      const partner = await makePartner("control")
      const orderId = await makeOrder(5)
      const txn = await send(orderId, partner.id)
      expect(await linkedPartner(orderId)).toBe(partner.id)

      await setStatus(orderId, "Shipped") // shipped, nothing received: not finished
      expect(await taskTransactionIds(orderId)).toContain(txn)
      await timeOut(txn)

      expect(await executionState(txn)).not.toBe("invoking")
      expect(await taskTransactionIds(orderId)).toEqual([]) // compensations ran
      expect(await linkedPartner(orderId)).toBeNull()
    })

    it("a timed-out workflow on a DELIVERED order keeps the partner link and emits no rollback", async () => {
      const partner = await makePartner("delivered")
      const orderId = await makeOrder(6)
      const txn = await send(orderId, partner.id)
      expect(await taskTransactionIds(orderId)).toContain(txn)

      await setStatus(orderId, "Delivered")
      await timeOut(txn)

      expect(await executionState(txn)).not.toBe("invoking")
      expect(await taskTransactionIds(orderId)).toEqual([]) // compensations ran …
      expect(await linkedPartner(orderId)).toBe(partner.id) // … and the link survived
      await new Promise((r) => setTimeout(r, 500))
      expect(await rollbackRows(orderId)).toHaveLength(0)
    })

    it("admin receive signals the waiting workflow so it completes instead of timing out", async () => {
      const partner = await makePartner("receive")
      const orderId = await makeOrder(7)
      const txn = await send(orderId, partner.id)
      expect(await executionState(txn)).toBe("invoking")

      await setStatus(orderId, "Shipped")
      const res = await post(`/admin/inventory-orders/${orderId}/receive`, {}, adminHeaders)
      expect(res.status).toBe(200)

      let state: string | null = "invoking"
      for (let i = 0; i < 40 && state === "invoking"; i++) {
        state = await executionState(txn)
        if (state === "invoking") await new Promise((r) => setTimeout(r, 250))
      }
      // Finished (row deleted, or `done` with retention) — and finished by
      // COMPLETING: a compensation would have cleared the tasks' transaction id.
      expect(state === null || state === "done").toBe(true)
      expect(await taskTransactionIds(orderId)).toContain(txn)
      expect(await linkedPartner(orderId)).toBe(partner.id)
    })

    it("admin receive of an order with no workflow still succeeds (signal is best-effort)", async () => {
      const orderId = await makeOrder(8)
      await setStatus(orderId, "Delivered")
      const res = await post(`/admin/inventory-orders/${orderId}/receive`, {}, adminHeaders)
      expect(res.status).toBe(200)
    })

    it("the repair job re-links a finished order un-linked by workflow_rollback; preview writes nothing", async () => {
      const partner = await makePartner("repair")
      const orderId = await makeOrder(9)
      const txn = await send(orderId, partner.id)
      // Reproduce the pre-fix damage: unfinished at timeout → un-linked …
      await timeOut(txn)
      expect(await linkedPartner(orderId)).toBeNull()
      // … then finished afterwards (as admin receive / close-received did).
      await setStatus(orderId, "Delivered")

      // The rollback row is written by the activity subscriber; wait for it.
      for (let i = 0; i < 40 && (await rollbackRows(orderId)).length === 0; i++) {
        await new Promise((r) => setTimeout(r, 250))
      }
      expect((await rollbackRows(orderId))[0]?.payload?.reason).toBe("workflow_rollback")

      const container = getContainer()
      const preview = await relinkRolledBackInventoryOrderPartnersJob.run(container, {
        dry_run: true,
        params: { order_ids: orderId },
      })
      expect(preview.changes.filter((c) => c.entity === "inventory_order").map((c) => c.id)).toEqual([orderId])
      expect(await linkedPartner(orderId)).toBeNull()

      const applied = await relinkRolledBackInventoryOrderPartnersJob.run(container, {
        dry_run: false,
        params: { order_ids: orderId },
      })
      expect(applied.applied).toBe(true)
      expect(await linkedPartner(orderId)).toBe(partner.id)

      // Idempotent: a second run has nothing to do.
      const again = await relinkRolledBackInventoryOrderPartnersJob.run(container, {
        dry_run: false,
        params: { order_ids: orderId },
      })
      expect(again.changes.filter((c) => c.entity === "inventory_order")).toHaveLength(0)
      expect(await linkedPartner(orderId)).toBe(partner.id)
    })
  })
})
