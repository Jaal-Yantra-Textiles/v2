import { useState } from "react";
import { Badge, Button, Input, Text, toast } from "@medusajs/ui";

import {
  AdminInventoryOrder,
  useResolveInventoryOrderShortfall,
} from "../../hooks/api/inventory-orders";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * #2289 S3 — short deliveries on this order: the receiver counted less than the
 * supplier dispatched. Open ones carry a one-line "what was done" and Resolve.
 * Resolving moves no stock and no money; the note is the record.
 */
export const InventoryOrderShortfalls = ({
  inventoryOrder,
}: {
  inventoryOrder: AdminInventoryOrder;
}) => {
  const rows = inventoryOrder.shortfalls ?? [];
  const { mutateAsync, isPending } = useResolveInventoryOrderShortfall(inventoryOrder.id);
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!rows.length) return null;

  return (
    <div className="mx-6 mb-4 flex flex-col gap-y-2 rounded-md border border-ui-border-base p-3">
      <Text size="small" weight="plus">Short deliveries</Text>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-y-2 border-t border-ui-border-base pt-2 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between gap-x-2">
            <Text size="small">
              Sent {fmt(r.dispatched_quantity)}, counted {fmt(r.received_quantity)}: <strong>{fmt(r.quantity)} short</strong>
            </Text>
            <Badge size="2xsmall" color={r.status === "open" ? "red" : "green"}>
              {r.status === "open" ? "Open" : "Resolved"}
            </Badge>
          </div>
          {r.status === "resolved" && r.resolution_note && (
            <Text size="xsmall" className="text-ui-fg-subtle">{r.resolution_note}</Text>
          )}
          {r.status === "open" && (
            <div className="flex items-center gap-x-2">
              <Input
                size="small"
                placeholder="What was done: re-sent, credited, written off…"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              <Button
                size="small"
                variant="secondary"
                isLoading={isPending}
                disabled={!(notes[r.id] ?? "").trim()}
                onClick={async () => {
                  try {
                    await mutateAsync({ shortfallId: r.id, note: (notes[r.id] ?? "").trim() });
                    toast.success("Shortfall resolved");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Resolve
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
