import {
  buildOrderLinesUpdatePayload,
  computeOrderLineTotals,
  type EditableOrderLine,
} from "../order-lines-payload";

const existing = (id: string, item: string, quantity: number, price: number): EditableOrderLine => ({
  id,
  inventory_item_id: item,
  quantity,
  price,
  isExisting: true,
});

const THREE: EditableOrderLine[] = [
  existing("ordli_A", "iitem_A", 10, 100),
  existing("ordli_B", "iitem_B", 5, 200),
  existing("ordli_C", "iitem_C", 3, 50),
];

describe("computeOrderLineTotals", () => {
  it("sums quantity and quantity×price, ignoring rows without an item", () => {
    const totals = computeOrderLineTotals([
      ...THREE,
      { inventory_item_id: "", quantity: 99, price: 99 }, // half-filled new row → ignored
    ]);
    expect(totals.totalQuantity).toBe(18);
    expect(totals.totalPrice).toBe(10 * 100 + 5 * 200 + 3 * 50); // 2150
  });
});

describe("buildOrderLinesUpdatePayload", () => {
  it("no change: keeps all existing lines by DB id and emits ZERO removals", () => {
    const payload = buildOrderLinesUpdatePayload(THREE, THREE);
    const removals = payload.order_lines.filter((l) => l.remove);
    const keeps = payload.order_lines.filter((l) => !l.remove);

    expect(removals).toHaveLength(0); // <- the regression guard for the wipe bug
    expect(keeps).toHaveLength(3);
    expect(keeps.map((l) => l.id)).toEqual(["ordli_A", "ordli_B", "ordli_C"]);
    expect(payload.data).toEqual({ quantity: 18, total_price: 2150 });
  });

  it("edit qty of an existing line: still no removals, id preserved", () => {
    const edited = [{ ...THREE[0], quantity: 99 }, THREE[1], THREE[2]];
    const payload = buildOrderLinesUpdatePayload(THREE, edited);
    expect(payload.order_lines.filter((l) => l.remove)).toHaveLength(0);
    const first = payload.order_lines.find((l) => l.id === "ordli_A");
    expect(first).toMatchObject({ id: "ordli_A", quantity: 99 });
  });

  it("add a new row: new line has no id, no spurious removals", () => {
    const withNew = [
      ...THREE,
      { inventory_item_id: "iitem_D", quantity: 3, price: 100, isExisting: false },
    ];
    const payload = buildOrderLinesUpdatePayload(THREE, withNew);
    expect(payload.order_lines.filter((l) => l.remove)).toHaveLength(0);
    const created = payload.order_lines.filter((l) => !l.remove && !l.id);
    expect(created).toHaveLength(1);
    expect(created[0].inventory_item_id).toBe("iitem_D");
  });

  it("remove ONE line: exactly one removal marker for the dropped DB id", () => {
    const remaining = [THREE[0], THREE[1]]; // dropped ordli_C
    const payload = buildOrderLinesUpdatePayload(THREE, remaining);
    const removals = payload.order_lines.filter((l) => l.remove);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ id: "ordli_C", remove: true });
    expect(removals[0].inventory_item_id).toBe("iitem_C"); // so the workflow dismisses the link
    expect(payload.order_lines.filter((l) => !l.remove).map((l) => l.id)).toEqual([
      "ordli_A",
      "ordli_B",
    ]);
  });

  it("remove ALL lines: a removal marker per line, no keeps", () => {
    const payload = buildOrderLinesUpdatePayload(THREE, []);
    expect(payload.order_lines.filter((l) => !l.remove)).toHaveLength(0);
    expect(payload.order_lines.filter((l) => l.remove).map((l) => l.id)).toEqual([
      "ordli_A",
      "ordli_B",
      "ordli_C",
    ]);
  });

  it("REGRESSION: field-array KEYS (not DB ids) must never fabricate removals", () => {
    // Simulate the #855 bug source: if currentLines carried react-hook-form
    // field keys instead of DB ids, EVERY existing line looked "gone".
    // The fix keeps DB ids on currentLines, so with all rows present there are
    // no removals. Here we assert the correct-input contract holds.
    const currentWithDbIds = THREE; // rows still present, real DB ids
    const payload = buildOrderLinesUpdatePayload(THREE, currentWithDbIds);
    expect(payload.order_lines.every((l) => !l.remove)).toBe(true);
  });
});
