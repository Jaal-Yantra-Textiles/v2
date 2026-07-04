import { INVENTORY_ORDER_TEMPLATES } from "../inventory-order-templates"
import { FLOW_DEF } from "../../seed-inventory-order-status-flow"
import { FLOW_DEF as PICKUP_FLOW_DEF } from "../../seed-inventory-shipment-pickup-flow"

/**
 * #771 — the inventory-order status flow sends `jyt_inventory_order_status_v1`.
 * This template must (a) exist in the registry so manage-whatsapp-templates.ts
 * pushes it to Meta for approval, and (b) match the contract the flow relies on
 * (name + 3 positional vars). Meta also enforces an identical body shape across
 * languages, so we pin that too.
 */
const countPlaceholders = (body: string): number => {
  const set = new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, "")))
  return set.size
}

describe("inventory-order WhatsApp template registry", () => {
  const tpl = INVENTORY_ORDER_TEMPLATES.find(
    (t) => t.name === "jyt_inventory_order_status_v1"
  )

  it("registers jyt_inventory_order_status_v1 as a UTILITY template", () => {
    expect(tpl).toBeTruthy()
    expect(tpl!.category).toBe("UTILITY")
    expect(tpl!.languages.length).toBeGreaterThanOrEqual(1)
  })

  it("uses exactly 3 positional placeholders, identical across languages, with matching examples", () => {
    const counts = tpl!.languages.map((l) => countPlaceholders(l.body))
    // Meta requires identical body shape across language variants.
    expect(new Set(counts).size).toBe(1)
    expect(counts[0]).toBe(3) // {{1}} partner, {{2}} order id, {{3}} status label
    // Every placeholder needs an example or Meta rejects the template.
    for (const l of tpl!.languages) {
      expect(l.examples.length).toBe(3)
    }
  })

  it("the flow sends exactly this template name (no drift)", () => {
    // resolve_message embeds the template name as a literal in its code string.
    const code = (FLOW_DEF.operations.find(
      (o) => o.operation_key === "resolve_message"
    )!.options as any).code as string
    expect(code).toContain("jyt_inventory_order_status_v1")
  })
})

describe("inventory-shipment pickup WhatsApp template registry (#888 S3)", () => {
  const tpl = INVENTORY_ORDER_TEMPLATES.find(
    (t) => t.name === "jyt_inventory_shipment_pickup_v1"
  )

  it("registers jyt_inventory_shipment_pickup_v1 as a UTILITY template", () => {
    expect(tpl).toBeTruthy()
    expect(tpl!.category).toBe("UTILITY")
    expect(tpl!.languages.length).toBeGreaterThanOrEqual(1)
  })

  it("uses exactly 4 positional placeholders, identical across languages, with matching examples", () => {
    const counts = tpl!.languages.map((l) => countPlaceholders(l.body))
    // Meta requires identical body shape across language variants.
    expect(new Set(counts).size).toBe(1)
    expect(counts[0]).toBe(4) // {{1}} partner, {{2}} order id, {{3}} awb, {{4}} milestone
    // Every placeholder needs an example or Meta rejects the template.
    for (const l of tpl!.languages) {
      expect(l.examples.length).toBe(4)
    }
  })

  it("the pickup flow sends exactly this template name (no drift)", () => {
    // resolve_message embeds the template name as a literal in its code string.
    const code = (PICKUP_FLOW_DEF.operations.find(
      (o) => o.operation_key === "resolve_message"
    )!.options as any).code as string
    expect(code).toContain("jyt_inventory_shipment_pickup_v1")
  })
})
