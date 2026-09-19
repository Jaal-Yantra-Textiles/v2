import { useMemo, useState } from "react";
import { Button, Heading, Input, Select, Text, Textarea, toast } from "@medusajs/ui";
import { ArrowDownTray, Buildings, CheckCircle, Plus, XMark } from "@medusajs/icons";

import {
  AdminInventoryOrder,
  useReceiveInventoryOrder,
} from "../../hooks/api/inventory-orders";
import { useAllStockLocations } from "../../hooks/api/stock_location";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useRouteModal } from "../modal/use-route-modal";
import {
  buildReceiptPayload,
  initialFormState,
  isPlainFullReceipt,
  toReceiptLineView,
  validateReceipt,
  type ReceiptFormState,
} from "./receipt-helpers";

/**
 * The GOODS RECEIPT form, rendered inside a RouteFocusModal (#2144).
 *
 * `Delivered` is a CARRIER event — it proves a parcel reached a door and moves
 * no stock. Counting it here is what puts it on our books. A line may be SPLIT
 * across locations (the partner keeps what they will cut, the balance goes to
 * our warehouse); both halves arrived, so a split is not a short delivery.
 *
 * The page's `InventoryOrderReceiptSection` only shows what has been counted
 * and the outstanding total; this form is where the counting happens.
 */
export const InventoryOrderReceiptForm = ({
  inventoryOrder,
}: {
  inventoryOrder: AdminInventoryOrder;
}) => {
  const { handleSuccess } = useRouteModal();

  const orderLines = ((inventoryOrder as any).orderlines ||
    inventoryOrder.order_lines ||
    []) as any[];

  const lines = useMemo(
    () => orderLines.map(toReceiptLineView).filter((l) => l.id),
    [orderLines],
  );

  const destination = (inventoryOrder as any).to_stock_location ||
    inventoryOrder.stock_locations?.[0] ||
    null;
  const partnerName =
    (inventoryOrder as any).partner?.name ||
    (inventoryOrder as any).partner?.handle ||
    null;

  const [notes, setNotes] = useState("");
  const [state, setState] = useState<ReceiptFormState>(() => initialFormState(lines));

  const { stock_locations } = useAllStockLocations();
  const { mutateAsync, isPending } = useReceiveInventoryOrder(inventoryOrder.id);

  const totalReceived = lines.reduce((s, l) => s + l.received, 0);
  const totalOrdered = lines.reduce((s, l) => s + l.ordered, 0);
  const totalOutstanding = lines.reduce((s, l) => s + l.outstanding, 0);
  const validation = validateReceipt(lines, state);

  const outstandingLines = lines.filter((l) => l.outstanding > 0);
  const countedLines = lines.filter((l) => l.received > 0);

  const setPortion = (lineId: string, key: string, patch: Partial<{ quantity: string; stock_location_id: string }>) =>
    setState((prev) => ({
      ...prev,
      [lineId]: (prev[lineId] || []).map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));

  const addPortion = (lineId: string) =>
    setState((prev) => {
      const portions = prev[lineId] || [];
      const claimed = portions.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
      const line = lines.find((l) => l.id === lineId);
      const left = Math.max(0, Number(((line?.outstanding ?? 0) - claimed).toFixed(6)));
      return {
        ...prev,
        [lineId]: [
          ...portions,
          {
            key: `${lineId}-${portions.length}-${Date.now()}`,
            quantity: left ? String(left) : "",
            stock_location_id: "",
          },
        ],
      };
    });

  const removePortion = (lineId: string, key: string) =>
    setState((prev) => ({
      ...prev,
      [lineId]: (prev[lineId] || []).filter((p) => p.key !== key),
    }));

  const submit = async () => {
    const payload = buildReceiptPayload(lines, state);
    if (!payload.length) {
      return;
    }
    try {
      const res = await mutateAsync({
        ...(isPlainFullReceipt(lines, payload) ? {} : { lines: payload }),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      const places = res.destination_location_ids?.length ?? 1;
      toast.success("Goods received onto stock", {
        description: `${res.postings.reduce((s, p) => s + p.quantity, 0)} units posted across ${places} location${places === 1 ? "" : "s"}.`,
      });
      handleSuccess();
    } catch (e: any) {
      toast.error("Could not receive the goods", {
        description: e?.message || "The receipt was refused.",
      });
    }
  };

  return (
    <>
      <RouteFocusModal.Header>
        <div>
          <Heading level="h2">Receive goods</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Count what arrived and put it on our books. “Delivered” only means the
            courier reached a door — this is what moves the stock.
          </Text>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-4 overflow-y-auto p-6">
        {/* Summary — what has been counted vs what is still to count. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-ui-border-base px-4 py-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Counted so far</Text>
            <Text size="large" weight="plus">
              {totalReceived} of {totalOrdered}
            </Text>
          </div>
          <div className="rounded-lg border border-ui-border-base px-4 py-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Still to count</Text>
            <Text size="large" weight="plus">{totalOutstanding}</Text>
          </div>
        </div>

        {totalOutstanding === 0 ? (
          <div className="flex items-center gap-x-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
            <CheckCircle className="text-ui-fg-success" />
            <Text size="small">Everything on this order has been counted.</Text>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {outstandingLines.map((line) => {
              const portions = state[line.id] || [];
              const error = validation.lineErrors[line.id];
              return (
                <div key={line.id} className="rounded-lg border border-ui-border-base px-4 py-3">
                  <div className="flex items-start justify-between gap-x-4">
                    <Text size="small" weight="plus">{line.label}</Text>
                    <Text size="small" className="shrink-0 text-ui-fg-subtle">
                      {line.outstanding} outstanding of {line.ordered}
                    </Text>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {portions.map((p, idx) => (
                      <div key={p.key} className="flex items-center gap-x-2">
                        <Input
                          size="small"
                          className="w-28"
                          type="number"
                          min={0}
                          step="any"
                          value={p.quantity}
                          placeholder="0"
                          aria-label={`Quantity received for ${line.label}`}
                          onChange={(e) => setPortion(line.id, p.key, { quantity: e.target.value })}
                        />
                        <Select
                          size="small"
                          value={p.stock_location_id || "__default__"}
                          onValueChange={(v) =>
                            setPortion(line.id, p.key, {
                              stock_location_id: v === "__default__" ? "" : v,
                            })
                          }
                        >
                          <Select.Trigger className="flex-1">
                            <Select.Value placeholder="Where it lands" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="__default__">
                              {destination ? `${destination.name} (order destination)` : "Order destination"}
                            </Select.Item>
                            {(stock_locations || [])
                              .filter((l) => l.id !== destination?.id)
                              .map((l) => (
                                <Select.Item key={l.id} value={l.id}>{l.name}</Select.Item>
                              ))}
                          </Select.Content>
                        </Select>
                        {portions.length > 1 && (
                          <Button
                            size="small"
                            variant="transparent"
                            aria-label="Remove this portion"
                            onClick={() => removePortion(line.id, p.key)}
                          >
                            <XMark />
                          </Button>
                        )}
                        {idx === portions.length - 1 && (
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={() => addPortion(line.id)}
                          >
                            <Plus /> Split
                          </Button>
                        )}
                      </div>
                    ))}
                    {error && (
                      <Text size="small" className="text-ui-fg-error">{error}</Text>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {destination && (
          <div className="flex items-start gap-x-2">
            <Buildings className="mt-0.5 shrink-0 text-ui-fg-muted" />
            <Text size="small" className="text-ui-fg-subtle">
              Anything left at the order destination lands at{" "}
              <span className="font-medium">{destination.name}</span>
              {partnerName && <> — {partnerName}’s own location, where they will cut it</>}. Split a
              line to send part of it somewhere else, such as our warehouse.
            </Text>
          </div>
        )}

        {countedLines.length > 0 && (
          <div className="flex flex-col gap-2">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Already on our books</Text>
            {countedLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between rounded-md bg-ui-bg-subtle px-4 py-2">
                <Text size="small" className="text-ui-fg-subtle">{line.label}</Text>
                <Text size="small" className="shrink-0 text-ui-fg-subtle">
                  {line.received} of {line.ordered}
                </Text>
              </div>
            ))}
          </div>
        )}

        <Textarea
          placeholder="What the count found — short metres, damaged rolls, who received it."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <Button size="small" variant="secondary" onClick={() => handleSuccess()} disabled={isPending}>
          Cancel
        </Button>
        <Button
          size="small"
          onClick={submit}
          disabled={!validation.canSubmit || isPending}
          isLoading={isPending}
        >
          <ArrowDownTray /> Receive onto stock
        </Button>
      </RouteFocusModal.Footer>
    </>
  );
};

export default InventoryOrderReceiptForm;