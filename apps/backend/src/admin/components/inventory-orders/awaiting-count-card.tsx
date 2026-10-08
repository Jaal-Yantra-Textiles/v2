import { Badge, Container, Heading, Text } from "@medusajs/ui";
import { Link } from "react-router-dom";

import { useInventoryOrdersAwaitingCount } from "../../hooks/api/inventory-orders";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * #2289 S2 — goods a supplier dispatched that nobody has counted.
 *
 * Since S1 a supplier's Complete posts no stock; only a count does. Anything
 * listed here is NOT on the books yet. Oldest dispatch first. Renders nothing
 * when the list is empty, so it only takes space when there is work.
 */
export const AwaitingCountCard = () => {
  const { orders, isPending } = useInventoryOrdersAwaitingCount();
  if (isPending || !orders.length) return null;

  return (
    <Container className="mb-3 divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Awaiting count</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Sent by the supplier, not counted yet. This stock is not on the books until someone receives it.
          </Text>
        </div>
        <Badge size="small" color="orange">{orders.length}</Badge>
      </div>
      {orders.map((o) => (
        <Link
          key={o.id}
          to={`/orders/inventory/${o.id}`}
          className="flex items-center justify-between gap-x-4 px-6 py-3 hover:bg-ui-bg-base-hover"
        >
          <div className="min-w-0">
            <Text size="small" weight="plus" className="truncate">
              {o.partner_name ?? "Supplier"} → {o.destination_name ?? "destination unknown"}
            </Text>
            <Text size="xsmall" className="truncate text-ui-fg-subtle">
              {o.lines.map((l) => `${l.title ?? l.line_id}: ${fmt(l.awaiting_count)}`).join(" · ")}
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-x-2">
            {o.carrier_delivered && <Badge size="2xsmall" color="blue">Carrier: delivered</Badge>}
            <Badge size="2xsmall" color={(o.days_since_dispatch ?? 0) >= 3 ? "red" : "grey"}>
              {o.days_since_dispatch === 0 ? "sent today" : `${o.days_since_dispatch ?? "?"}d ago`}
            </Badge>
            <Text size="small" className="tabular-nums">{fmt(o.awaiting_quantity)}</Text>
          </div>
        </Link>
      ))}
    </Container>
  );
};
