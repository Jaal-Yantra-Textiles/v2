import { Container, Heading, Text, toast, usePrompt } from "@medusajs/ui";
import { PencilSquare, Trash, ArrowUpRightOnBox } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { AdminInventoryOrder, useDeleteInventoryOrder } from "../../hooks/api/inventory-orders";



export const InventoryOrderGeneralSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeleteInventoryOrder(inventoryOrder.id);

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
        navigate("/inventory/orders", { replace: true });
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
              actions: [
                { label: "Delete", icon: <Trash />, onClick: handleDelete },
              ],
            },
          ]}
        />
      </div>
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
