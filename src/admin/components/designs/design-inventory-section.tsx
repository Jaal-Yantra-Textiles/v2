import { Container, Heading, Skeleton, Text } from "@medusajs/ui";
import { Plus, TriangleRightMini } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign, useDesignInventory } from "../../hooks/api/designs";  
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Thumbnail } from "../common/thumbnail";

// Define the explicit inventory item interface
interface InventoryItem {
  id: string;
  title?: string;
  thumbnail?: string | null;
}

// Define the interface for API response inventory item object 
interface ApiInventoryItem {
  id: string | number;
  title?: string;
  thumbnail?: string | null;
  [key: string]: any; // For any other potential properties
}

interface DesignInventorySectionProps {
  design: AdminDesign;
}

export const DesignInventorySection = ({ design }: DesignInventorySectionProps) => {
  const navigate = useNavigate();
  const { data, isLoading } = useDesignInventory(design.id);  
  
  // Transform items into proper inventory items with proper object handling
  const inventoryItems: InventoryItem[] = data?.inventory_items?.map(item => {
    // Check if the item is an object with an id property
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const typedItem = item as ApiInventoryItem;
      return {
        id: String(typedItem.id),
        title: typedItem.title ? String(typedItem.title) : `Inventory Item ${String(typedItem.id)}`,
        thumbnail: typedItem.thumbnail || null,
      };
    }
    
    // Fallback for primitives
    const id = String(item);
    return {
      id,
      title: `Inventory Item ${id}`,
    };
  }) || [];
  
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-4">
          <Heading level="h2">Inventory Used</Heading>
          </div>
        <div className="flex items-center gap-x-4">
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Add Inventory",
                  icon: <Plus />,
                  onClick: () => {
                    navigate(`/designs/${design.id}/addinv`);
                  },
                },
              ],
            },
          ]}
        />
        </div>
      </div>
        {isLoading ? (
          <Skeleton className="h-7 w-full" />
        ) : (
          <div className="txt-small flex flex-col gap-2 px-2 pb-2">
            {!inventoryItems.length ? (
              <div className="px-6 py-4 text-ui-fg-subtle">
                <Text>No inventory items found</Text>
              </div>
            ) : (
              inventoryItems.map((item) => {
                const link = `/inventory/${item.id}`;
                
                const Inner = (
                  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="shadow-elevation-card-rest bg-ui-bg-base rounded-md flex items-center justify-center text-ui-fg-subtle">
                        <Thumbnail src={item.thumbnail} />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span className="text-ui-fg-base font-medium">
                          {item.title || `Inventory Item ${item.id}`}
                        </span>
                        <span className="text-ui-fg-subtle">
                          {item.id || "-"}
                        </span>
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
                    key={item.id}
                    className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
                  >
                    {Inner}
                  </Link>
                );
              })
            )}
          </div>
        )}
    </Container>
  );
};
