import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { TriangleRightMini } from "@medusajs/icons";
import { AdminInventoryOrder, OrderLine } from "../../hooks/api/inventory-orders";
import { Link } from "react-router-dom";

export const InventoryOrderLinesSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Define extended line type with inventory_item relation
  type InventoryOrderLine = OrderLine & { inventory_items: [{ id: string; sku: string; title?: string }] };

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Order Lines</Heading>
        </div>
      </div>
      
      <div className="txt-small flex flex-col gap-2 px-2 pb-2">
        {!inventoryOrder.orderlines?.length ? (
          <div className="px-6 py-4 text-ui-fg-subtle">
            <Text>No order lines found</Text>
          </div>
        ) : (
          inventoryOrder.orderlines.map((line: InventoryOrderLine, idx: number) => {
            const inventoryItem = line.inventory_items[0];
            const link = `/inventory/items/${inventoryItem.id}`;
            
            const Inner = (
              <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="text-ui-fg-base font-medium">
                      {inventoryItem.sku}
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
