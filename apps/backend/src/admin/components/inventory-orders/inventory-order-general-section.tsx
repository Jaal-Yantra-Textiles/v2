import { useState } from "react";
import { Container, Heading, Text, StatusBadge, toast, usePrompt } from "@medusajs/ui";
import { PencilSquare, Trash, ArrowUpRightOnBox, TruckFast, CheckCircle } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import {
  AdminInventoryOrder,
  useDeleteInventoryOrder,
  useMarkInventoryOrderReadyForDelivery,
} from "../../hooks/api/inventory-orders";
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
  getStatusBadgeColor,
} from "../../lib/work-status";
import { InventoryOrderShipmentModal } from "./inventory-order-shipment-modal";

// #790 — which statuses allow each action. Ready-for-delivery requires the
// order to be at least partially fulfilled (completion recorded) — not raw
// "Processing", where nothing has been produced yet.
const READY_FOR_DELIVERY_FROM = new Set(["Partial"]);
const SHIPPABLE = new Set(["Processing", "Ready for Delivery", "Partial", "Shipped"]);

export const InventoryOrderGeneralSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeleteInventoryOrder(inventoryOrder.id);
  const { mutateAsync: markReady } = useMarkInventoryOrderReadyForDelivery(inventoryOrder.id);
  const [shipmentOpen, setShipmentOpen] = useState(false);

  const canMarkReady = READY_FOR_DELIVERY_FROM.has(inventoryOrder.status);
  const canShip = SHIPPABLE.has(inventoryOrder.status);

  const handleMarkReady = async () => {
    await markReady(undefined, {
      onSuccess: () => toast.success('Marked "Ready for Delivery"'),
      onError: (error: any) => toast.error(error?.message || "Failed to update status"),
    });
  };

  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete Inventory Order",
      description: `Are you sure you want to delete order ${inventoryOrder.id}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      verificationInstruction: "Type the order ID to confirm",
      verificationText: inventoryOrder.id,
    });
    if (!confirmed) {
      return;
    }
    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Inventory order deleted");
        navigate("/orders/inventory", { replace: true });
      },
      onError: (error: any) => {
        toast.error(error.message || "Failed to delete order");
      },
    });
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{`Summary`}</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                { label: "Edit", icon: <PencilSquare />, to: "edit" },
                { label: "Send to Partner", icon: <ArrowUpRightOnBox />, to: "send-to-partner" },
              ],
            },
            {
              // #790 — fulfilment actions, gated by the order's current status.
              actions: [
                ...(canMarkReady
                  ? [{ label: "Mark Ready for Delivery", icon: <CheckCircle />, onClick: handleMarkReady }]
                  : []),
                ...(canShip
                  ? [{ label: "Create shipment", icon: <TruckFast />, onClick: () => setShipmentOpen(true) }]
                  : []),
              ],
            },
            {
              actions: [
                { label: "Delete", icon: <Trash />, onClick: handleDelete },
              ],
            },
          ]}
        />
      </div>
      <InventoryOrderShipmentModal
        inventoryOrder={inventoryOrder}
        open={shipmentOpen}
        onOpenChange={setShipmentOpen}
      />
      {getPartnerWorkStatus(inventoryOrder) && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" weight="plus">Work status</Text>
          <div>
            <StatusBadge
              color={getStatusBadgeColor(getPartnerWorkStatus(inventoryOrder))}
              className="text-nowrap"
            >
              {PARTNER_STATUS_LABELS[getPartnerWorkStatus(inventoryOrder)!] ??
                getPartnerWorkStatus(inventoryOrder)}
            </StatusBadge>
          </div>
        </div>
      )}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Quantity</Text>
        <Text size="small">{inventoryOrder.quantity}</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Total Price</Text>
        <Text size="small">{inventoryOrder.total_price}</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Order Date</Text>
        <Text size="small">{new Date(inventoryOrder.order_date).toLocaleDateString()}</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Expected Delivery</Text>
        <Text size="small">{new Date(inventoryOrder.expected_delivery_date).toLocaleDateString()}</Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Sample Order</Text>
        {inventoryOrder.is_sample ? (
          <Text size="small">{'Yes'}</Text>
        ) : (
          <Text size="small">{'No'}</Text>
        )}
      </div>
    </Container>
  );
};

export default InventoryOrderGeneralSection;
