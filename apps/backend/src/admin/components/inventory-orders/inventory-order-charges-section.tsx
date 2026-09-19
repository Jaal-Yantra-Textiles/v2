import { Container, Heading, Text } from "@medusajs/ui";

import {
  AdminInventoryOrder,
  AdminInventoryOrderCharge,
  useInventoryOrderCharges,
} from "../../hooks/api/inventory-orders";

/**
 * What an inventory order is really worth, once the amounts that are not goods
 * are counted (#1737).
 *
 * ## Why this section exists
 *
 * The order detail showed ONE money line — `Total Price`, raw and unformatted —
 * and that column means GOODS. An order carrying tax and freight understated
 * itself on the only screen an operator reads. The GOF order
 * `inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF` carried 2,800 of IGST and 60 of
 * packing against 55,988 of cloth: the page said 55,988 and the partner was
 * owed up to 58,848.
 *
 * ⚠️ The arithmetic is NOT here. `totals` and `payable_ceiling` are folded by
 * `orderPayableCeiling` server-side — the same lib `assessInventoryOrderClaims`
 * uses — so this screen cannot quote a ceiling the write guard would reject.
 * Each row's `direction` arrives with it for the same reason.
 *
 * Read-only. Applying a charge is a money decision and stays an explicit action.
 */

const LABELS: Record<string, string> = {
  tax: "Tax",
  shipping: "Packing & shipping",
  discount: "Discount",
  adjustment: "Adjustment",
};

const money = (amount: number, currency?: string | null) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || "INR").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // An unknown currency code must not blank the whole money block.
    return `${amount}`;
  }
};

const Row = ({
  label,
  value,
  strong,
  bordered,
}: {
  label: string;
  value: string;
  strong?: boolean;
  bordered?: boolean;
}) => (
  <div
    className={`flex items-center justify-between px-6 py-3${
      bordered ? " border-ui-border-base border-t" : ""
    }`}
  >
    <Text size="small" weight={strong ? "plus" : undefined} className={strong ? undefined : "text-ui-fg-subtle"}>
      {label}
    </Text>
    <Text size="small" weight={strong ? "plus" : undefined} className={strong ? undefined : "text-ui-fg-subtle"}>
      {value}
    </Text>
  </div>
);

export const InventoryOrderChargesSection = ({
  inventoryOrder,
}: {
  inventoryOrder: AdminInventoryOrder;
}) => {
  const { charges, goods_total, payable_ceiling, isLoading } =
    useInventoryOrderCharges(inventoryOrder.id);

  const currency = (inventoryOrder as any)?.currency_code ?? null;

  /**
   * A `direction: 0` row is a type the BACKEND did not recognise. It is dropped
   * rather than shown as a raise — guessing it upward invents an obligation,
   * which is the direction that overpays.
   */
  const applied: AdminInventoryOrderCharge[] = (charges ?? []).filter(
    (c) => Number(c?.direction) !== 0 && Number(c?.amount),
  );

  // Nothing to explain when the order is goods and only goods.
  if (isLoading || applied.length === 0) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Charges</Heading>
      </div>

      <div className="flex flex-col">
        <Row label="Goods" value={money(Number(goods_total ?? 0), currency)} />

        {applied.map((charge) => (
          <Row
            key={charge.id}
            label={charge.note?.trim() || LABELS[charge.type] || charge.type}
            value={`${Number(charge.direction) < 0 ? "-" : ""}${money(
              Math.abs(Number(charge.amount) || 0),
              currency,
            )}`}
          />
        ))}

        <Row
          label="Payable ceiling"
          value={money(Number(payable_ceiling ?? 0), currency)}
          strong
          bordered
        />
      </div>
    </Container>
  );
};

export default InventoryOrderChargesSection;
