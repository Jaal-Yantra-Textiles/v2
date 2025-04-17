import { Container, Heading, Text, InlineTip } from "@medusajs/ui";
import { AdminInventoryOrder, OrderLine } from "../../hooks/api/inventory-orders";

export const InventoryOrderLinesSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Define extended line type with inventory_item relation
  type InventoryOrderLine = OrderLine & { inventory_item: { id: string; sku: string } };

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-4">
        <Heading>Order Lines</Heading>
      </div>
      
      <div className="flex flex-col divide-y text-ui-fg-subtle">
        {inventoryOrder.orderlines.map((line: InventoryOrderLine, idx: number) => (
          <div
            key={line.inventory_item.id || idx}
            className="grid grid-cols-2 px-6 py-4 text-ui-fg-subtle"
          >
            {/* Left: ID, SKU, Price */}
            <div>
              <Text size="small" className="text-ui-fg-subtle">{line.inventory_item.sku}</Text>
              <Text size="small">Price: {line.price}</Text>
            </div>
            {/* Right: Bold quantity with tooltip */}
            <div className="flex justify-end">
              <Text size="small" weight="plus">
                <InlineTip label={`${line.quantity}`}>Ordered quantity</InlineTip>
              </Text>
            </div>
          </div>
        ))}
      </div>
      
    </Container>
  );
};

export default InventoryOrderLinesSection;
