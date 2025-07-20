import { Container, Heading, StatusBadge, Text} from "@medusajs/ui";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";

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
