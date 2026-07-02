/**
 * Pure builders for the PUT /admin/inventory-orders/:id/order-lines payload.
 *
 * Extracted from the edit-order-lines form and unit-tested because a subtle
 * id-identity bug here silently wiped whole orders in prod:
 *
 *   react-hook-form's `useFieldArray` overwrites each row's `id` with its OWN
 *   generated field key (default keyName === "id"). The form compared those
 *   field keys against the database line ids to decide which lines were
 *   removed — two id-spaces that can NEVER match — so every existing line was
 *   marked for removal on EVERY save, deleting the entire order.
 *
 * The fix is twofold: the form sets a non-"id" `keyName` so `fields[i].id`
 * keeps carrying the DB id, and the removal diff lives here behind unit tests.
 * These functions therefore assume existing rows carry their real DB id.
 */

export interface EditableOrderLine {
  /** DB order-line id for existing lines; absent/undefined for brand-new rows. */
  id?: string;
  inventory_item_id: string;
  quantity: number;
  price: number;
  batch_number?: number | null;
  /** True for rows that already exist in the database. */
  isExisting?: boolean;
}

export interface OrderLineUpdateEntry {
  id?: string;
  inventory_item_id?: string;
  quantity?: number;
  price?: number;
  batch_number?: number | null;
  remove?: boolean;
}

export interface OrderLinesUpdatePayload {
  data: { quantity: number; total_price: number };
  order_lines: OrderLineUpdateEntry[];
}

/** Sum quantity and quantity×price across the given lines. */
export function computeOrderLineTotals(lines: EditableOrderLine[]): {
  totalQuantity: number;
  totalPrice: number;
} {
  const valid = lines.filter((l) => l && l.inventory_item_id);
  const totalQuantity = valid.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const totalPrice = valid.reduce(
    (sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 0),
    0
  );
  return { totalQuantity, totalPrice };
}

/**
 * Build the update payload from the form's original existing lines and the rows
 * currently present in the field array.
 *
 * - Each present row becomes a keep/update entry. Existing rows carry their DB
 *   id (→ update in place); new rows omit it (→ create).
 * - Every original existing line that is NO LONGER present becomes a removal
 *   marker (soft-delete + link dismiss server-side). A removal only needs `id`;
 *   `inventory_item_id` is included so the workflow can dismiss the item link.
 *
 * `currentLines[i].id` MUST be the DB id for existing rows (see file header).
 */
export function buildOrderLinesUpdatePayload(
  existingLines: EditableOrderLine[],
  currentLines: EditableOrderLine[]
): OrderLinesUpdatePayload {
  const keep: OrderLineUpdateEntry[] = currentLines.map((line) => ({
    id: line.isExisting && line.id ? line.id : undefined,
    inventory_item_id: line.inventory_item_id,
    quantity: Number(line.quantity) || 0,
    price: Number(line.price) || 0,
    batch_number: line.batch_number ?? null,
  }));

  const remainingExistingIds = new Set(
    currentLines.filter((l) => l.isExisting && l.id).map((l) => l.id as string)
  );
  const removals: OrderLineUpdateEntry[] = existingLines
    .filter((l) => l.id && !remainingExistingIds.has(l.id))
    .map((l) => ({
      id: l.id,
      inventory_item_id: l.inventory_item_id || undefined,
      remove: true,
    }));

  const totals = computeOrderLineTotals(currentLines);

  return {
    data: { quantity: totals.totalQuantity, total_price: totals.totalPrice },
    order_lines: [...keep, ...removals],
  };
}
