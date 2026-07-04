import { FLOW_DEF } from "../seed-inventory-shipment-pickup-flow"

/**
 * Structural guards for the inventory-shipment pickup WhatsApp visual flow seed
 * (#888 S3).
 *
 * This flow is editor-gated and cannot be live-verified by the daemon. It wires
 * the #888 shipment status-changed event + the send_whatsapp op by STRING name
 * only, and the resolve_message code references shipment-shaped trigger payload
 * paths that only the carrier tracking webhook / shipment creation emit. A typo
 * in any of these would silently no-op at runtime, so these tests pin the
 * contract.
 */
describe("seed-inventory-shipment-pickup-flow FLOW_DEF", () => {
  const byKey = Object.fromEntries(
    FLOW_DEF.operations.map((o) => [o.operation_key, o])
  )

  it("is an event-triggered draft flow on the #888 shipment status-changed event", () => {
    expect(FLOW_DEF.status).toBe("draft")
    expect(FLOW_DEF.trigger_type).toBe("event")
    expect(FLOW_DEF.trigger_config.event_types).toEqual([
      "inventory_orders.inventory-shipment.status-changed",
    ])
    // canvas trigger node mirrors the persisted trigger_config exactly.
    expect(
      (FLOW_DEF.canvas_state.nodes[0].data as any).triggerConfig.event_types
    ).toEqual(FLOW_DEF.trigger_config.event_types)
  })

  it("wires read_data → execute_code → condition → send_whatsapp / log", () => {
    expect(byKey.read_order.operation_type).toBe("read_data")
    expect(byKey.resolve_message.operation_type).toBe("execute_code")
    expect(byKey.has_message.operation_type).toBe("condition")
    expect(byKey.send.operation_type).toBe("send_whatsapp")
    expect(byKey.log_skip.operation_type).toBe("log")
    // sort_order is contiguous from 0 in execution order.
    expect(FLOW_DEF.operations.map((o) => o.sort_order)).toEqual([0, 1, 2, 3, 4])
  })

  it("reads the inventory order by the shipment payload's order_id, with partner + admins", () => {
    const read = byKey.read_order.options as any
    expect(read.entity).toBe("inventory_orders")
    // The event payload is shipment-shaped: order_id carries the order, NOT
    // payload.id (that's the shipment id).
    expect(read.filters).toEqual({ id: "{{ $trigger.payload.order_id }}" })
    expect(read.limit).toBe(1)
    // must pull the partner relation + admins to resolve a recipient.
    expect(read.fields).toEqual(
      expect.arrayContaining([
        "partner.id",
        "partner.name",
        "partner.whatsapp_number",
        "partner.admins.phone",
        "partner.admins.is_active",
      ])
    )
  })

  it("resolve_message reads the shipment payload shape #888 emits", () => {
    const code = (byKey.resolve_message.options as any).code as string
    expect(code).toContain("$trigger?.payload?.id")
    expect(code).toContain("$trigger?.payload?.order_id")
    expect(code).toContain("$trigger?.payload?.status")
    expect(code).toContain("$trigger?.payload?.awb")
    expect(code).toContain("$trigger?.payload?.pickup_scheduled_date")
    // reads the order the read_order node produced.
    expect(code).toContain("$input.read_order?.records?.[0]")
  })

  it("notifies only the pickup milestones (transit/delivered are skipped)", () => {
    const code = (byKey.resolve_message.options as any).code as string
    expect(code).toContain('"pickup_scheduled"')
    expect(code).toContain('"picked_up"')
    // unmapped statuses fall through to a skip.
    expect(code).toContain("status_not_notified")
    // transit scans + order-level milestones are NOT notified here — the #771
    // status flow handles Shipped/Delivered.
    expect(code).not.toContain('"in_transit"')
    expect(code).not.toContain('"out_for_delivery"')
    expect(code).not.toContain('"delivered"')
    expect(code).not.toContain('newStatus === "delivered"')
  })

  it("condition gates send on resolve_message.skipped === false", () => {
    const cond = byKey.has_message.options as any
    expect(cond.expression).toBe("resolve_message.skipped === false")
    expect(cond.filter_rule).toEqual({
      "resolve_message.skipped": { _eq: false },
    })
  })

  it("send_whatsapp interpolates the resolved template payload with dedup", () => {
    const send = byKey.send.options as any
    expect(send.mode).toBe("template")
    expect(send.template_name).toBe("{{ resolve_message.template_name }}")
    expect(send.variables).toBe("{{ resolve_message.variables }}")
    expect(send.to).toBe("{{ resolve_message.to }}")
    expect(send.context_type).toBe("{{ resolve_message.context_type }}")
    expect(send.context_id).toBe("{{ resolve_message.context_id }}")
    expect(send.dedup_window_minutes).toBe(60)
    expect(send.require_partner).toBe(true)
  })

  it("dedup context_id is per (shipment, milestone) so each pickup sends once", () => {
    const code = (byKey.resolve_message.options as any).code as string
    expect(code).toContain('shipmentId + ":" + newStatus')
    expect(code).toContain('context_type: "inventory_shipment"')
  })

  it("has matching canvas edges and connection rows (success/failure fan-out)", () => {
    const conn = FLOW_DEF.connections.map((c) => `${c.source_id}->${c.target_id}`)
    const edges = FLOW_DEF.canvas_state.edges.map((e) => `${e.source}->${e.target}`)
    expect(conn).toEqual(edges)
    expect(conn).toEqual([
      "trigger->read_order",
      "read_order->resolve_message",
      "resolve_message->has_message",
      "has_message->send",
      "has_message->log_skip",
    ])
    // the condition's two arms carry the right handles.
    const arms = Object.fromEntries(
      FLOW_DEF.connections
        .filter((c) => c.source_id === "has_message")
        .map((c) => [c.target_id, c.connection_type])
    )
    expect(arms).toEqual({ send: "success", log_skip: "failure" })
  })
})
