import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { INBOUND_ORDER_UPDATE_FLOW_DEF } from "../../src/scripts/seed-inbound-order-update-flow"
import { VISUAL_FLOWS_MODULE } from "../../src/modules/visual_flows"
import { logInboundOrderUpdateWorkflow } from "../../src/workflows/inbound-emails/log-inbound-order-update"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { linkedInventoryOrderIds } from "../../src/workflows/inbound-emails/lib/inbound-email-links"

jest.setTimeout(90000)

/**
 * A supplier's follow-up email ("shipped", tracking) becomes ONE timeline row on
 * the order it is about, and nothing else: no status change, no new order.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  const createEmail = (overrides: Record<string, any> = {}) =>
    (getContainer().resolve("inbound_emails") as any).createInboundEmails({
      imap_uid: `uid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      from_address: "support@jhonea.com",
      to_addresses: ["orders-inventory-external@jaalyantra.com"],
      subject: "Your order JH27228 has shipped",
      html_body: "<p>Order #JH27228 shipped via Delhivery, AWB 1504877063931</p>",
      folder: "JYT_INBOUND_ORDERS",
      received_at: new Date("2026-10-09T08:00:00Z"),
      status: "received",
      ...overrides,
    })

  const createOrder = (metadata: Record<string, any>) =>
    (getContainer().resolve(ORDER_INVENTORY_MODULE) as any).createInventoryOrders({
      quantity: 124,
      total_price: 2847,
      status: "Pending",
      metadata,
    })

  const run = async (inbound_email_id: string, extracted: Record<string, any>) => {
    const { result } = await logInboundOrderUpdateWorkflow(getContainer()).run({
      input: { inbound_email_id, extracted },
    })
    return result as any
  }

  const activitiesOf = async (orderId: string) =>
    (getContainer().resolve(ORDER_INVENTORY_MODULE) as any).listInventoryOrderActivities({
      inventory_order_id: orderId,
    })

  const shipped = {
    order_number: "#JH27228",
    update_type: "Shipped",
    carrier: "Delhivery",
    tracking_number: "1504877063931",
  }

  it("logs the update on the matching order, links and processes the email, changes nothing else", async () => {
    const source = await createEmail({ subject: "Order JH27228 confirmed" })
    const order = await createOrder({
      supplier_order_number: "JH27228",
      inbound_email_id: source.id,
    })
    const email = await createEmail()

    const result = await run(email.id, shipped)
    expect(result.outcome).toBe("logged")
    expect(result.inventory_order_id).toBe(order.id)

    const acts = await activitiesOf(order.id)
    expect(acts).toHaveLength(1)
    expect(acts[0].kind).toBe("supplier_email_update")
    expect(acts[0].summary).toContain("Shipped: Delhivery 1504877063931")
    expect(acts[0].payload.inbound_email_id).toBe(email.id)

    const after = await (getContainer().resolve(ORDER_INVENTORY_MODULE) as any).retrieveInventoryOrder(order.id)
    expect(after.status).toBe("Pending")

    const reread = await (getContainer().resolve("inbound_emails") as any).retrieveInboundEmail(email.id)
    expect(reread.status).toBe("processed")
    expect(reread.action_type).toBe("log_inventory_order_update")
    expect((await linkedInventoryOrderIds(getContainer(), [email.id])).get(email.id)).toEqual([order.id])

    // A retried flow run writes nothing more.
    const again = await run(email.id, shipped)
    expect(again.outcome).toBe("already_logged")
    expect(await activitiesOf(order.id)).toHaveLength(1)
  })

  it("the confirmation the order was created from is not logged as an update", async () => {
    const source = await createEmail({ subject: "Order JH27228 confirmed" })
    const order = await createOrder({ supplier_order_number: "JH27228", inbound_email_id: source.id })

    const result = await run(source.id, { order_number: "JH27228" })
    expect(result.outcome).toBe("is_source_email")
    expect(await activitiesOf(order.id)).toHaveLength(0)
  })

  it("no matching order → nothing written, no order created, email left for review", async () => {
    const service = getContainer().resolve(ORDER_INVENTORY_MODULE) as any
    const before = (await service.listInventoryOrders({})).length
    const email = await createEmail({ subject: "Your order ZZ1 has shipped" })

    const result = await run(email.id, { order_number: "ZZ1", update_type: "Shipped" })
    expect(result.outcome).toBe("no_match")
    expect((await service.listInventoryOrders({})).length).toBe(before)

    const reread = await (getContainer().resolve("inbound_emails") as any).retrieveInboundEmail(email.id)
    expect(reread.status).toBe("received")
    expect(reread.error_message).toContain("ZZ1")
  })

  it("two orders with the same supplier number → ambiguous, nothing written", async () => {
    const a = await createOrder({ supplier_order_number: "JH5" })
    const b = await createOrder({ order_number: "JH5" })
    const email = await createEmail()

    const result = await run(email.id, { order_number: "JH5" })
    expect(result.outcome).toBe("ambiguous")
    expect(result.inventory_order_ids.sort()).toEqual([a.id, b.id].sort())
    expect(await activitiesOf(a.id)).toHaveLength(0)
    expect(await activitiesOf(b.id)).toHaveLength(0)
  })

  it("the seeded flow, run end to end, logs the update on the order (AI step mocked)", async () => {
    await createAdminUser(getContainer())
    const headers = await getAuthHeaders(api)
    const order = await createOrder({ supplier_order_number: "JH27228" })
    const email = await createEmail()

    const def = INBOUND_ORDER_UPDATE_FLOW_DEF
    const flow = await (getContainer().resolve(VISUAL_FLOWS_MODULE) as any).createCompleteFlow({
      flow: {
        name: def.name,
        status: "active",
        trigger_type: "manual",
        trigger_config: def.trigger_config,
        canvas_state: def.canvas_state,
      },
      // The real definition, with only the AI call replaced.
      operations: def.operations.map((op) =>
        op.operation_key === "parse_update"
          ? { ...op, options: { ...op.options, mock_response: shipped } }
          : op
      ),
      connections: def.connections,
    })

    const exec = await api.post(
      `/admin/visual-flows/${flow.id}/execute`,
      { trigger_data: { id: email.id } },
      { ...headers, validateStatus: () => true }
    )
    expect(exec.status).toBe(200)

    // The read step found the email (a wrong entity name reads back empty).
    const executions = await (getContainer().resolve(VISUAL_FLOWS_MODULE) as any).listVisualFlowExecutions({
      flow_id: flow.id,
    })
    expect(executions[0]?.status).toBe("completed")
    expect(executions[0].data_chain.read_email.records[0].id).toBe(email.id)

    const acts = await activitiesOf(order.id)
    expect(acts).toHaveLength(1)
    expect(acts[0].payload.tracking_number).toBe("1504877063931")
  })
})
