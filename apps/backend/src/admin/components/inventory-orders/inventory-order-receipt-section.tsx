import { useMemo } from "react";
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui";
import { ArrowDownTray, ExclamationCircle } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";

import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { canReceiveFrom, toReceiptLineView } from "./receipt-helpers";

/**
 * GOODS RECEIPT — the summary that did not exist (#2144).
 *
 * 🔴 `Delivered` is a CARRIER event. The Shiprocket webhook writes it, it proves
 * a parcel reached a door, and it moves NO stock. Two pashminas sat at
 * `stocked_quantity: 0` at Kiyo Designs for nine days on the strength of an
 * OTP-verified scan, with nothing having failed anywhere.
 *
 * This section is deliberately a SUMMARY: it shows what has been counted and a
 * single aggregate of what has not. The counting itself lives in a
 * RouteFocusModal (`@receipt`), opened with the "Receive goods" button — a full
 * form behind a click, not a wall of inputs stacked into the detail page.
 */
export const InventoryOrderReceiptSection = ({
  inventoryOrder,
}: {
  inventoryOrder: AdminInventoryOrder;
}) => {
  const navigate = useNavigate();

  const orderLines = ((inventoryOrder as any).orderlines ||
    inventoryOrder.order_lines ||
    []) as any[];

  const lines = useMemo(
    () => orderLines.map(toReceiptLineView).filter((l) => l.id),
    [orderLines],
  );

  const receivable = canReceiveFrom(inventoryOrder.status);
  const totalReceived = lines.reduce((s, l) => s + l.received, 0);
  const totalOrdered = lines.reduce((s, l) => s + l.ordered, 0);
  const totalOutstanding = lines.reduce((s, l) => s + l.outstanding, 0);
  const nothingCounted = totalReceived === 0;
  const countedLines = lines.filter((l) => l.received > 0);
  const outstandingCount = lines.filter((l) => l.outstanding > 0).length;

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
        {receivable && totalOutstanding > 0 && (
          <Button
            size="small"
            variant="secondary"
            onClick={() => navigate(`/orders/inventory/${inventoryOrder.id}/receipt`)}
          >
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

      {/* Summary: what has been counted, and the aggregate of what has not. */}
      <div className="grid grid-cols-2 gap-3 px-6 pb-4">
        <div className="rounded-md bg-ui-bg-subtle px-4 py-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Counted</Text>
          <Text size="large" weight="plus">
            {totalReceived} of {totalOrdered}
          </Text>
        </div>
        <div className="rounded-md bg-ui-bg-subtle px-4 py-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Still to count</Text>
          <Text size="large" weight="plus">{totalOutstanding}</Text>
        </div>
      </div>

      {countedLines.length > 0 && (
        <div className="flex flex-col gap-1 px-6 pb-4">
          {countedLines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-x-4">
              <Text size="small" className="text-ui-fg-subtle">{line.label}</Text>
              <Text size="small" className="shrink-0 text-ui-fg-subtle">
                {line.received} of {line.ordered} received
              </Text>
            </div>
          ))}
        </div>
      )}

      {receivable && totalOutstanding > 0 && (
        <div className="border-t border-ui-border-base px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {totalOutstanding} unit{totalOutstanding === 1 ? "" : "s"} across{" "}
            {outstandingCount} line{outstandingCount === 1 ? "" : "s"} still need counting.
            Receiving puts them on our books — split a line to land part of it somewhere other than
            the order’s destination.
          </Text>
        </div>
      )}
    </Container>
  );
};

export default InventoryOrderReceiptSection;