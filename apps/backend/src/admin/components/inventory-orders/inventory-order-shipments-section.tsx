import { useState } from "react";
import { Badge, Container, Heading, Text } from "@medusajs/ui";
import { ArrowUpRightOnBox, DocumentText } from "@medusajs/icons";

type InventoryOrderShipmentsSectionProps = {
  inventoryOrder: any;
};

const STATUS_COLOR: Record<string, "green" | "blue" | "red" | "orange"> = {
  created: "blue",
  pickup_scheduled: "orange",
  picked_up: "blue",
  in_transit: "blue",
  out_for_delivery: "orange",
  delivered: "green",
  rto: "red",
  cancelled: "red",
};

const STATUS_LABEL: Record<string, string> = {
  created: "Created",
  pickup_scheduled: "Pickup scheduled",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rto: "RTO",
  cancelled: "Cancelled",
};

const ShipmentRow = ({ s }: { s: any }) => {
  const [showTracking, setShowTracking] = useState(false);
  const awb = s.awb || s.tracking_number;
  const dims = s.dimensions_cm || {};
  const dimText = [dims.length, dims.width ?? dims.breadth, dims.height]
    .filter((v: any) => v != null)
    .join("×");
  // #888 — carrier webhook tracking events (append-only, oldest first, capped
  // 50). `last_webhook` is the raw carrier payload and is never rendered here.
  const trackingEvents: any[] = Array.isArray(s?.metadata?.tracking_events)
    ? s.metadata.tracking_events
    : [];
  return (
    <div className="flex flex-col gap-y-2 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-3">
          <Badge size="2xsmall" color={STATUS_COLOR[s.status] || "blue"}>
            {STATUS_LABEL[s.status] || s.status}
          </Badge>
          <Text size="small" className="text-ui-fg-base capitalize">
            {s.carrier}
          </Text>
          {awb &&
            (s.tracking_url ? (
              <a
                href={s.tracking_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              >
                <Text size="small">AWB {awb}</Text>
                <ArrowUpRightOnBox className="text-ui-fg-muted" />
              </a>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                AWB {awb}
              </Text>
            ))}
        </div>
        {s.label_url && (
          <a
            href={s.label_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1 text-ui-fg-subtle transition-colors hover:bg-ui-bg-base hover:text-ui-fg-base"
          >
            <DocumentText className="text-ui-fg-muted" />
            <Text size="xsmall">Label</Text>
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 pl-1">
        {s.pickup_location_name && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            Pickup: {s.pickup_location_name}
            {s.pickup_scheduled_date ? ` · ${s.pickup_scheduled_date}` : ""}
          </Text>
        )}
        {s.weight_grams != null && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {s.weight_grams} g{dimText ? ` · ${dimText} cm` : ""}
          </Text>
        )}
        {s.created_at && (
          <Text size="xsmall" className="text-ui-fg-muted">
            {new Date(s.created_at).toLocaleString()}
          </Text>
        )}
      </div>
      {trackingEvents.length > 0 && (
        <div className="pl-1">
          <button
            type="button"
            onClick={() => setShowTracking((v) => !v)}
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          >
            <Text size="xsmall">
              Tracking history ({trackingEvents.length})
            </Text>
          </button>
          {showTracking && (
            <div className="mt-2 flex flex-col gap-y-1">
              {[...trackingEvents].reverse().map((ev: any, idx: number) => (
                <Text key={idx} size="xsmall" className="text-ui-fg-subtle">
                  {ev.status}
                  {ev.status_code != null && ev.status_code !== ""
                    ? ` (${ev.status_code})`
                    : ""}
                  {ev.received_at
                    ? ` · ${new Date(ev.received_at).toLocaleString()}`
                    : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </Text>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Carrier shipments generated for this inventory order (#772 follow-up) —
 * reads the first-class `inventory_shipment` rows the shipment workflow now
 * persists (newest first), replacing the invisible metadata.shipment blob.
 */
export const InventoryOrderShipmentsSection = ({
  inventoryOrder,
}: InventoryOrderShipmentsSectionProps) => {
  const shipments: any[] = inventoryOrder?.shipments || [];
  // Back-compat: orders shipped before the shipment table existed only carry
  // the metadata blob — surface that one so history doesn't vanish.
  const legacy = inventoryOrder?.metadata?.shipment;
  const rows =
    shipments.length > 0 ? shipments : legacy ? [{ id: "legacy", ...legacy, status: "created" }] : [];

  // #888 S4 — confirm-receipt nudge. Stock receipt is MANUAL by design: when
  // every real (non-legacy) shipment is delivered (and none are still in flight
  // or cancelled-without-delivery), remind the admin to verify and record
  // received quantities before closing the order. Shown only for first-class
  // shipment rows, never the legacy blob.
  const nonCancelledShipments = shipments.filter(
    (s: any) => s?.status !== "cancelled"
  );
  const allDelivered =
    shipments.length > 0 &&
    nonCancelledShipments.length > 0 &&
    nonCancelledShipments.every((s: any) => s?.status === "delivered");
  const showReceiptNudge =
    allDelivered && inventoryOrder?.status !== "Cancelled";

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Shipments</Heading>
          <Badge size="2xsmall" className="ml-2">
            {rows.length}
          </Badge>
        </div>
      </div>
      {showReceiptNudge && (
        <div className="bg-ui-bg-subtle border rounded-md p-3 m-3">
          <Text size="small" className="text-ui-fg-base">
            All shipments delivered — confirm stock receipt
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            The carrier reports delivery, but stock receipt stays manual: verify
            received quantities and record them via the order completion flow
            before closing this order.
          </Text>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="px-6 py-4">
          <Text
            size="small"
            className="text-ui-fg-subtle px-6 py-8 border-ui-border-base text-center"
          >
            No shipments created yet.
          </Text>
        </div>
      ) : (
        <div className="px-6 py-2 flex flex-col divide-y">
          {rows.map((s: any) => (
            <ShipmentRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </Container>
  );
};
