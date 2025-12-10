import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { TriangleRightMini, PencilSquare } from "@medusajs/icons";
import { AdminInventoryOrder, OrderLine } from "../../hooks/api/inventory-orders";
import { Link } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";

export const InventoryOrderLinesSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Define extended line type with inventory_item relation
  type InventoryOrderLine = OrderLine & { inventory_items: [{ id: string; sku: string; title?: string }] };

  // Only allow editing if status is Pending or Processing
  const canEdit = ["Pending", "Processing"].includes(inventoryOrder.status);

  // Handle both orderlines (from API) and order_lines (from type)
  const orderLines = (inventoryOrder as any).orderlines || inventoryOrder.order_lines || [];
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Order Lines</Heading>
        </div>
        {canEdit && (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit",
                    to: `editorder`,
                    icon: <PencilSquare />,
                  },
                ],
              },
            ]}
          />
        )}
      </div>
      
      <div className="txt-small flex flex-col gap-2 px-2 pb-2">
        {!orderLines.length ? (
          <div className="px-6 py-4 text-ui-fg-subtle">
            <Text>No order lines found</Text>
          </div>
        ) : (
          orderLines.map((line: InventoryOrderLine, idx: number) => {
            const inventoryItem = line.inventory_items?.[0];
            
            // Skip lines without inventory item data
            if (!inventoryItem) {
              return null;
            }
            
            const link = `/inventory/${inventoryItem.id}`;
            
            const Inner = (
              <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="text-ui-fg-base font-medium">
                      {inventoryItem.title}
                    </span>
                    <div className="flex gap-2 mt-2">
                      <Badge size="small" className="text-ui-fg-subtle">Price: ${line.price}</Badge>
                      <Badge size="small" className="text-ui-fg-subtle">Quantity: {line.quantity}</Badge>
                    </div>
                  </div>
                  <div className="size-7 flex items-center justify-center">
                    <TriangleRightMini className="text-ui-fg-muted" />
                  </div>
                </div>
              </div>
            );
            
            return (
              <Link
                to={link}
                key={inventoryItem.id || idx}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                {Inner}
              </Link>
            );
          })
        )}
      </div>
    </Container>
  );
};

export default InventoryOrderLinesSection;
