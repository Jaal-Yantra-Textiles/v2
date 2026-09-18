import { useMemo, useState } from "react";
import { Container, Heading, Text, Badge, Button, Input, Select, Textarea, toast } from "@medusajs/ui";
import { ArrowDownTray, Buildings, ExclamationCircle, Plus, XMark } from "@medusajs/icons";

import {
  AdminInventoryOrder,
  useReceiveInventoryOrder,
} from "../../hooks/api/inventory-orders";
import { useAllStockLocations } from "../../hooks/api/stock_location";
import {
  buildReceiptPayload,
  canReceiveFrom,
  initialFormState,
  isPlainFullReceipt,
  toReceiptLineView,
  validateReceipt,
  type ReceiptFormState,
} from "./receipt-helpers";

/**
 * GOODS RECEIPT — the button that did not exist (#2144).
 *
 * 🔴 `Delivered` is a CARRIER event. The Shiprocket webhook writes it, it proves
 * a parcel reached a door, and it moves NO stock. The route and the MCP tool to
 * post the goods have existed since #2118; nothing in the admin ever called
 * them. Two pashminas sat at `stocked_quantity: 0` at Kiyo Designs for nine days
 * on the strength of an OTP-verified scan, with nothing having failed anywhere.
 *
 * The dated case this is built for: the GOF order, 86 m, ₹69,340, expected
 * around 2026-10-08. When it lands, #2111's supply gate releases the partner's
 * run automatically — but the cloth is on our books only if a human counts it.
 * Without this, the run starts against material the system believes we do not
 * have, and every consumption log against it goes negative.
 *
 * SPLITTING is first-class, not an edge case: the partner keeps what they will
 * cut and the balance goes to our own warehouse. Both halves arrived. Goods
 * genuinely going back to the supplier are an inspection matter on the order,
 * not a destination on this form.
 */
export const InventoryOrderReceiptSection = ({
  inventoryOrder,
}: {
  inventoryOrder: AdminInventoryOrder;
}) => {
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
  // A consignment order's destination IS a partner's location (#2111), which is
  // deliberate and surprising enough that the screen says it out loud.
  const partnerName =
    (inventoryOrder as any).partner?.name ||
    (inventoryOrder as any).partner?.handle ||
    null;

  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<ReceiptFormState>(() => initialFormState(lines));

  const { stock_locations } = useAllStockLocations({ enabled: open });
  const { mutateAsync, isPending } = useReceiveInventoryOrder(inventoryOrder.id);

  const receivable = canReceiveFrom(inventoryOrder.status);
  const totalOutstanding = lines.reduce((s, l) => s + l.outstanding, 0);
  const totalReceived = lines.reduce((s, l) => s + l.received, 0);
  const nothingCounted = totalReceived === 0;
  const validation = validateReceipt(lines, state);

  const openForm = () => {
    setState(initialFormState(lines));
    setNotes("");
    setOpen(true);
  };

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
        // Receive-everything is sent as an empty body so the server takes its
        // own default — the path the MCP tool exercises, and the better-worn one.
        ...(isPlainFullReceipt(lines, payload) ? {} : { lines: payload }),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      const places = res.destination_location_ids?.length ?? 1;
      toast.success("Goods received onto stock", {
        description: `${res.postings.reduce((s, p) => s + p.quantity, 0)} units posted across ${places} location${places === 1 ? "" : "s"}.`,
      });
      setOpen(false);
    } catch (e: any) {
      toast.error("Could not receive the goods", {
        description: e?.message || "The receipt was refused.",
      });
    }
  };

  if (!lines.length) {
    return null;
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading level="h2">Goods receipt</Heading>
          {totalOutstanding === 0 ? (
            <Badge size="2xsmall" color="green">Fully received</Badge>
          ) : totalReceived > 0 ? (
            <Badge size="2xsmall" color="orange">Partly received</Badge>
          ) : (
            <Badge size="2xsmall" color="grey">Not counted</Badge>
          )}
        </div>
        {receivable && totalOutstanding > 0 && !open && (
          <Button size="small" variant="secondary" onClick={openForm}>
            <ArrowDownTray /> Receive goods
          </Button>
        )}
      </div>

      {/* 🔴 The sentence this whole screen exists to say. */}
      {inventoryOrder.status === "Delivered" && nothingCounted && (
        <div className="mx-6 mb-4 flex gap-x-3 rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
          <ExclamationCircle className="mt-0.5 shrink-0 text-ui-fg-error" />
          <div>
            <Text size="small" weight="plus">The carrier says delivered. Nobody has counted it.</Text>
            <Text size="small" className="text-ui-fg-subtle">
              “Delivered” comes from the courier and proves a parcel reached a door. No stock has
              moved and the level still reads zero. Receiving it here is what puts it on our books.
            </Text>
          </div>
        </div>
      )}

      {!receivable && (
        <div className="px-6 pb-4">
          <Text size="small" className="text-ui-fg-subtle">
            Nothing can be received from <span className="font-medium">{inventoryOrder.status}</span> — goods
            have to have left the supplier first.
          </Text>
        </div>
      )}

      <div className="flex flex-col gap-2 px-6 pb-4">
        {lines.map((line) => {
          const portions = state[line.id] || [];
          const error = validation.lineErrors[line.id];
          return (
            <div key={line.id} className="rounded-md bg-ui-bg-subtle px-4 py-3">
              <div className="flex items-start justify-between gap-x-4">
                <Text size="small" weight="plus">{line.label}</Text>
                <Text size="small" className="shrink-0 text-ui-fg-subtle">
                  {line.received} of {line.ordered} received
                  {line.outstanding > 0 && ` · ${line.outstanding} outstanding`}
                </Text>
              </div>

              {open && line.outstanding > 0 && (
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
              )}
            </div>
          );
        })}
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-ui-border-base px-6 py-4">
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
          <Textarea
            placeholder="What the count found — short metres, damaged rolls, who received it."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex items-center justify-end gap-x-2">
            <Button size="small" variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="small"
              onClick={submit}
              disabled={!validation.canSubmit || isPending}
              isLoading={isPending}
            >
              Receive onto stock
            </Button>
          </div>
        </div>
      )}
    </Container>
  );
};

export default InventoryOrderReceiptSection;
