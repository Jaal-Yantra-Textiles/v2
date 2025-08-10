import { Container, Heading, Text } from "@medusajs/ui";
import { Buildings } from "@medusajs/icons";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { Link } from "react-router-dom";

const StockLocCard = ({ title, location }: { title: string; location: any | null }) => (
  <Container className="p-0">
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-x-4">
        <Heading level="h2">{title}</Heading>
      </div>
    </div>
    <div className="txt-small flex flex-col gap-2 px-2 pb-2">
      {!location ? (
        <div className="px-6 py-4 text-ui-fg-subtle">
          <Text>No stock location assigned</Text>
        </div>
      ) : (
        <div className="px-0">
          <Link
            to={`/settings/locations/${location.id}`}
            className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
          >
            <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-full bg-ui-bg-base p-2 text-ui-fg-subtle">
                  <Buildings className="text-ui-fg-muted" />
                </div>
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="text-ui-fg-base font-medium">{location.name}</span>
                  {location.address && (
                    <div className="flex gap-2 mt-1">
                      <Text size="small" className="text-ui-fg-subtle">
                        {location.address.city || ""}
                        {location.address.country_code ? `, ${location.address.country_code}` : ""}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
  </Container>
);

export const InventoryOrderStockLocation = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Prefer augmented fields from workflow; fallback to first stock_locations entry for to-location
  const toLoc = (inventoryOrder as any).to_stock_location || (inventoryOrder.stock_locations?.[0] ?? null);
  const fromLoc = (inventoryOrder as any).from_stock_location || null;

  return (
    <div className="flex flex-col gap-4">
      <StockLocCard title="From Location" location={fromLoc} />
      <StockLocCard title="To Location" location={toLoc} />
    </div>
  );
};
     

export default InventoryOrderStockLocation;
