import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { Buildings, MapPin } from "@medusajs/icons";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { Link } from "react-router-dom";

export const InventoryOrderStockLocation = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Check if stock location data exists
  const hasStockLocation = inventoryOrder.stock_locations && inventoryOrder.stock_locations.length > 0;
  const stockLocation = hasStockLocation ? inventoryOrder.stock_locations[0] : null;
  
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Shipping to</Heading>
        </div>
      </div>
      
      <div className="txt-small flex flex-col gap-2 px-2 pb-2">
        {!hasStockLocation ? (
          <div className="px-6 py-4 text-ui-fg-subtle">
            <Text>No stock location assigned</Text>
          </div>
        ) : (
          <div className="px-0">
            {stockLocation && (
              <Link
                to={`/settings/locations/${stockLocation.id}`}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center rounded-full bg-ui-bg-base p-2 text-ui-fg-subtle">
                      <Buildings className="text-ui-fg-muted" />
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="text-ui-fg-base font-medium">
                        {stockLocation.name}
                      </span>
                      {stockLocation.address && (
                        <div className="flex gap-2 mt-1">
                          <Text size="small" className="text-ui-fg-subtle">
                            {stockLocation.address.city || ""}
                            {stockLocation.address.country_code ? `, ${stockLocation.address.country_code}` : ""}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            )}
          </div>
        )}
      </div>
    </Container>
  );
};
     

export default InventoryOrderStockLocation;
