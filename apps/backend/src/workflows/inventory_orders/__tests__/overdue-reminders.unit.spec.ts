import {
  selectOverdueReminders,
  INVENTORY_ORDER_REMINDER_OVERDUE_EVENT,
} from "../overdue-reminders";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const past = (days: number) =>
  new Date(NOW.getTime() - days * 86400000).toISOString();
const future = (days: number) =>
  new Date(NOW.getTime() + days * 86400000).toISOString();

describe("selectOverdueReminders (#778 H5)", () => {
  it("selects an open order past its expected delivery date", () => {
    const due = selectOverdueReminders(
      [{ id: "o1", status: "Processing", expected_delivery_date: past(3), partner_id: "p1" }],
      new Set(),
      NOW
    );
    expect(due).toEqual([
      {
        id: "o1",
        partner_id: "p1",
        expected_delivery_date: new Date(past(3)).toISOString(),
        days_overdue: 3,
      },
    ]);
  });

  it("skips Delivered and Cancelled orders", () => {
    const due = selectOverdueReminders(
      [
        { id: "d", status: "Delivered", expected_delivery_date: past(5) },
        { id: "c", status: "Cancelled", expected_delivery_date: past(5) },
      ],
      new Set(),
      NOW
    );
    expect(due).toEqual([]);
  });

  it("skips orders not yet overdue", () => {
    const due = selectOverdueReminders(
      [{ id: "o", status: "Processing", expected_delivery_date: future(2) }],
      new Set(),
      NOW
    );
    expect(due).toEqual([]);
  });

  it("skips orders with no expected delivery date", () => {
    const due = selectOverdueReminders(
      [{ id: "o", status: "Processing", expected_delivery_date: null }],
      new Set(),
      NOW
    );
    expect(due).toEqual([]);
  });

  it("skips orders already reminded within the cooldown", () => {
    const due = selectOverdueReminders(
      [{ id: "o1", status: "Partial", expected_delivery_date: past(10) }],
      new Set(["o1"]),
      NOW
    );
    expect(due).toEqual([]);
  });

  it("includes Partial orders (still open)", () => {
    const due = selectOverdueReminders(
      [{ id: "o1", status: "Partial", expected_delivery_date: past(1) }],
      new Set(),
      NOW
    );
    expect(due.map((d) => d.id)).toEqual(["o1"]);
  });

  it("ignores rows with no id or unparseable dates", () => {
    const due = selectOverdueReminders(
      [
        { id: "", status: "Processing", expected_delivery_date: past(2) },
        { id: "bad", status: "Processing", expected_delivery_date: "not-a-date" },
      ],
      new Set(),
      NOW
    );
    expect(due).toEqual([]);
  });

  it("exports a stable event name", () => {
    expect(INVENTORY_ORDER_REMINDER_OVERDUE_EVENT).toBe(
      "inventory_orders.inventory-order.reminder-overdue"
    );
  });
});
