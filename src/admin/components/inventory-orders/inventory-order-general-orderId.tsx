import { Container, Heading, StatusBadge, Text} from "@medusajs/ui";
import { ChatBubbleLeftRight } from "@medusajs/icons";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { ActionMenu } from "../common/action-menu";

const orderStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "orange";
      case "completed":
        return "green";
      case "cancelled":
        return "red";
      default:
        return "grey";
    }
  };

export const InventoryOrderIDSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{`Order #${inventoryOrder.id}`}</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Add Feedback",
                  icon: <ChatBubbleLeftRight />,
                  to: `/inventory/orders/${inventoryOrder.id}/add-feedback`,
                },
              ],
            },
          ]}
        />
        </div>
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" weight="plus">Status</Text>
        <div className="flex items-center">
          <StatusBadge color={orderStatusColor(inventoryOrder.status)}>
            {inventoryOrder.status}
          </StatusBadge>
        </div>
      </div>
    </Container>
  );
};

export default InventoryOrderIDSection;
