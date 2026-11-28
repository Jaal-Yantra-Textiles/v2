import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui";
import { ArrowUpRightOnBox, DocumentText } from "@medusajs/icons";

import { inventoryOrderQueryKeys } from "../../hooks/api/inventory-orders";
import { VITE_MEDUSA_BACKEND_URL } from "../../lib/config";

type InventoryOrderShipmentsSectionProps = {
  inventoryOrder: any;
};

const STATUS_COLOR: Record<string, "green" | "blue" | "red" | "orange"> = {
  booking_pending: "orange",
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
  booking_pending: "Booking requested",
  created: "Created",
  pickup_scheduled: "Pickup scheduled",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rto: "RTO",
  cancelled: "Cancelled",
};

const CARRIER_LABEL: Record<string, string> = {
  shiprocket: "Shiprocket",
  delhivery: "Delhivery",
  dtdc: "DTDC",
  india_post: "India Post",
};

const carrierLabel = (carrier?: string | null) =>
  (carrier && CARRIER_LABEL[carrier]) || carrier || "";

type CompleteBookingInput = {
  awb: string;
  trackingUrl: string;
  notes: string;
  file: File | null;
};

/**
 * A partner asked us to book this India Post shipment by hand (status
 * `booking_pending`, no AWB yet). Shows what they asked for and lets the admin
 * record the AWB + label once booked at the post office.
 */
const ManualBookingPanel = ({
  s,
  inventoryOrderId,
}: {
  s: any;
  inventoryOrderId: string;
}) => {
  const queryClient = useQueryClient();
  const [awb, setAwb] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const request = s?.metadata?.manual_booking || {};
  const dims = s.dimensions_cm || {};
  const dimText = [dims.length, dims.width ?? dims.breadth, dims.height]
    .filter((v: any) => v != null)
    .join("×");

  const { mutate, isPending } = useMutation({
    mutationFn: async (input: CompleteBookingInput) => {
      const formData = new FormData();
      formData.append("awb", input.awb);
      if (input.trackingUrl) formData.append("tracking_url", input.trackingUrl);
      if (input.notes) formData.append("notes", input.notes);
      if (input.file) {
        formData.append("files", input.file, input.file.name || "label.pdf");
      }

      const base = VITE_MEDUSA_BACKEND_URL?.replace(/\/$/, "") || "";
      const url = `${base}/admin/inventory-orders/${inventoryOrderId}/shipments/${s.id}/manual-booking`;

      const res = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (data && (data.message || data.error)) ||
          `Booking failed with status ${res.status}`;
        throw new Error(message);
      }
      return data as { shipment: any };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: inventoryOrderQueryKeys.detail(inventoryOrderId),
      });
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      const newAwb = data?.shipment?.awb || awb.trim();
      toast.success(`Booking recorded — AWB ${newAwb}`);
      setAwb("");
      setTrackingUrl("");
      setNotes("");
      setFile(null);
      setFileInputKey((k) => k + 1);
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to record booking");
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] || null;
    if (
      picked &&
      picked.type !== "application/pdf" &&
      !picked.name.toLowerCase().endsWith(".pdf")
    ) {
      toast.error("The label must be a PDF file");
      setFile(null);
      setFileInputKey((k) => k + 1);
      return;
    }
    setFile(picked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedAwb = awb.trim();
    if (!trimmedAwb) {
      toast.error("Enter the AWB / consignment number");
      return;
    }
    mutate({
      awb: trimmedAwb,
      trackingUrl: trackingUrl.trim(),
      notes: notes.trim(),
      file,
    });
  };

  const fieldId = (name: string) => `manual-booking-${s.id}-${name}`;

  return (
    <div className="flex flex-col gap-y-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
      <div className="flex flex-col gap-y-1">
        <Text size="small" leading="compact" weight="plus">
          Partner asked us to book this {carrierLabel(s.carrier)} shipment
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {request.requested_by ? `By ${request.requested_by}` : "Requested"}
          {request.requested_at
            ? ` · ${new Date(request.requested_at).toLocaleString()}`
            : ""}
        </Text>
        {request.pickup_date && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            Pickup date: {request.pickup_date}
          </Text>
        )}
        {s.weight_grams != null && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {s.weight_grams} g{dimText ? ` · ${dimText} cm` : ""}
          </Text>
        )}
        {request.notes && (
          <Text size="xsmall" className="text-ui-fg-subtle whitespace-pre-wrap">
            Notes: {request.notes}
          </Text>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-2">
        <Text size="small" leading="compact" weight="plus">
          Complete booking
        </Text>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label size="small" htmlFor={fieldId("awb")}>
              AWB / consignment no.
            </Label>
            <Input
              id={fieldId("awb")}
              size="small"
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
              placeholder="e.g. EE123456789IN"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label size="small" htmlFor={fieldId("tracking")}>
              Tracking URL (optional)
            </Label>
            <Input
              id={fieldId("tracking")}
              size="small"
              type="url"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label size="small" htmlFor={fieldId("notes")}>
            Notes (optional)
          </Label>
          <Textarea
            id={fieldId("notes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label size="small" htmlFor={fieldId("label")}>
            Label PDF (optional)
          </Label>
          <input
            key={fileInputKey}
            id={fieldId("label")}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="text-ui-fg-subtle txt-compact-small"
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="small"
            type="submit"
            isLoading={isPending}
            disabled={isPending || !awb.trim()}
          >
            Complete booking
          </Button>
        </div>
      </form>
    </div>
  );
};

const ShipmentRow = ({
  s,
  inventoryOrderId,
}: {
  s: any;
  inventoryOrderId: string;
}) => {
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
          <Text size="small" className="text-ui-fg-base">
            {carrierLabel(s.carrier)}
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
      {s.status === "booking_pending" && s.id !== "legacy" && (
        <ManualBookingPanel s={s} inventoryOrderId={inventoryOrderId} />
      )}
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
  const inventoryOrderId: string = inventoryOrder?.id;
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
  // shipment rows, never the legacy blob. A `booking_pending` row (India Post
  // asked for, not yet booked) is not cancelled and not delivered, so — like a
  // `created` row still in flight — it keeps the nudge hidden until it ships.
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
            <ShipmentRow key={s.id} s={s} inventoryOrderId={inventoryOrderId} />
          ))}
        </div>
      )}
    </Container>
  );
};
