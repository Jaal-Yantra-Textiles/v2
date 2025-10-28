import { Container, Heading, Skeleton, Text, toast } from "@medusajs/ui";
import { Plus, Trash, TriangleRightMini } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign, useDesignInventory, useDelinkInventory } from "../../hooks/api/designs";  
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";


// Define the explicit inventory item interface
interface InventoryItem {
  id: string;
  title?: string;
  thumbnail?: string | null;
  sku?: string;
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
  const { mutateAsync: delinkInventory, isPending: isDelinking } = useDelinkInventory(design.id);  
  
  // Transform items into proper inventory items
  const inventoryItems: InventoryItem[] = data?.inventory_items?.map(item => {
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const typedItem = item as ApiInventoryItem;
      return {
        id: String(typedItem.id),
        title: typedItem.title || `Inventory Item ${String(typedItem.id)}`,
        thumbnail: typedItem.thumbnail || null,
        sku: typedItem.sku || `SKU ${String(typedItem.id)}`,
      };
    }
    
    const id = String(item);
    return {
      id,
      title: `Inventory Item ${id}`,
      sku: `SKU ${id}`,
    };
  }) || [];
  
  const handleRemoveInventory = async (inventoryId: string) => {
    try {
      await delinkInventory({
        inventoryIds: [inventoryId]
      });
      toast.success("Success", {
        description: "Inventory item removed successfully",
        dismissable: true,
      });
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to remove inventory item",
        dismissable: true,
      });
    }
  };
  
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Inventory</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Inventory items used in this design
          </Text>
        </div>
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
        {isLoading ? (
          <Skeleton className="h-7 w-full" />
        ) : (
          <div className="txt-small flex flex-col gap-2 px-1 pb-2">
            {!inventoryItems.length ? (
              <div className="flex items-center justify-center py-4 w-full">
                <Text className="text-ui-fg-subtle">No inventory items found</Text>
              </div>
            ) : (
              inventoryItems.map((item) => {
                const link = `/inventory/${item.id}`;
                
                const Inner = (
                  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <span className="text-ui-fg-base font-medium">
                          {item.title}
                        </span>
                        <span className="text-ui-fg-subtle text-sm">
                          {item.sku}
                        </span>
                        <span className="text-ui-fg-subtle text-xs truncate max-w-[150px] sm:max-w-[200px] md:max-w-full block">
                          {item.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-x-2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleRemoveInventory(item.id);
                          }}
                          disabled={isDelinking}
                          className="size-7 flex items-center justify-center text-ui-fg-muted hover:text-ui-fg-subtle transition-colors disabled:opacity-50"
                          title="Remove inventory item"
                        >
                          <Trash className="size-5" />
                        </button>
                        <div className="size-7 flex items-center justify-center">
                          <TriangleRightMini className="text-ui-fg-muted" />
                        </div>
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
