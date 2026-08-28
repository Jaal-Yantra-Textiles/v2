import {
  describePaymentLine,
  paymentLineKind,
} from "../payment-line-source"

/**
 * How a payout line describes itself on screen.
 *
 * 🔴 The defect this replaces: the submission page filtered lines into exactly
 * two buckets, `design` and `task`. `source_type` has been
 * `design | task | run | inventory_order` since #1614, so run- and
 * inventory-order-sourced lines matched NEITHER filter and rendered NOWHERE —
 * the GOF payout showed a ₹30,000 total with no line explaining it, under a
 * stat tile that called an inventory order a "Design".
 */
describe("paymentLineKind", () => {
  it("takes source_type when it is set", () => {
    expect(paymentLineKind({ source_type: "inventory_order" })).toBe(
      "inventory_order"
    )
  })

  /** ⚠️ A missing source_type is NOT design — only the ids can say. */
  it("infers from ids when source_type is absent", () => {
    expect(paymentLineKind({ inventory_order_id: "inv_1" })).toBe("inventory_order")
    expect(paymentLineKind({ production_run_ids: ["r"] })).toBe("run")
    expect(paymentLineKind({ task_id: "t" })).toBe("task")
    expect(paymentLineKind({ design_id: "d" })).toBe("design")
  })

  it("says unknown rather than guessing when there is nothing to go on", () => {
    expect(paymentLineKind({})).toBe("unknown")
  })
})

describe("describePaymentLine", () => {
  it("describes an inventory-order line as an inventory order", () => {
    expect(
      describePaymentLine({
        source_type: "inventory_order",
        inventory_order_id: "inv_order_1",
        inventory_order_name: "Inventory order inv_order_1",
      })
    ).toEqual({
      kind: "inventory_order",
      label: "Inventory order",
      title: "Inventory order inv_order_1",
      reference: "inv_order_1",
    })
  })

  /**
   * The grouping is the point: seven runs are ONE payout, so the line reports
   * how many runs it covers rather than naming one of them as though the other
   * six were something else.
   */
  it("describes a run line by its run COUNT, not by one run", () => {
    const described = describePaymentLine({
      source_type: "run",
      order_id: "order_79",
      production_run_ids: ["a", "b", "c", "d", "e", "f", "g"],
    })

    expect(described.label).toBe("Production runs")
    expect(described.title).toBe("7 production runs")
    expect(described.reference).toBe("order_79")
  })

  it("singularises a one-run line", () => {
    expect(
      describePaymentLine({ source_type: "run", production_run_ids: ["a"] }).title
    ).toBe("1 production run")
  })

  it("prefers a stated label over the run count", () => {
    expect(
      describePaymentLine({
        source_type: "run",
        design_name: "Retail order #79 - 7 garments",
        production_run_ids: ["a", "b"],
      }).title
    ).toBe("Retail order #79 - 7 garments")
  })

  it("falls back to a run id when the line names no order", () => {
    expect(
      describePaymentLine({
        source_type: "run",
        production_run_ids: ["prod_run_1"],
      }).reference
    ).toBe("prod_run_1")
  })

  it("describes a design line", () => {
    expect(
      describePaymentLine({
        source_type: "design",
        design_id: "design_1",
        design_name: "Namtso Shirt",
      })
    ).toEqual({
      kind: "design",
      label: "Design",
      title: "Namtso Shirt",
      reference: "design_1",
    })
  })

  it("describes a task line", () => {
    expect(
      describePaymentLine({ source_type: "task", task_id: "task_1" })
    ).toEqual({
      kind: "task",
      label: "Task",
      title: "Untitled task",
      reference: "task_1",
    })
  })

  /**
   * An unattributable line must still RENDER. Returning nothing is how these
   * lines disappeared in the first place.
   */
  it("still describes a line with no source at all", () => {
    const described = describePaymentLine({})

    expect(described.kind).toBe("unknown")
    expect(described.title).toBe("Unattributed line")
    expect(described.reference).toBeNull()
  })

  /** Every source type must produce a renderable description — no undefineds. */
  it.each([
    ["design", { source_type: "design" }],
    ["task", { source_type: "task" }],
    ["run", { source_type: "run" }],
    ["inventory_order", { source_type: "inventory_order" }],
    ["unknown", {}],
  ])("gives %s a non-empty label and title", (_kind, line) => {
    const described = describePaymentLine(line as any)

    expect(described.label).toBeTruthy()
    expect(described.title).toBeTruthy()
  })
})
