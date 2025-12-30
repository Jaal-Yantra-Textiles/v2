import { Container, Heading, Skeleton, Text, toast } from "@medusajs/ui"
import { Plus, Trash, InformationCircle } from "@medusajs/icons"
import { ActionMenu } from "../common/action-menu"
import { AdminDesign, LinkedInventoryItem, useDesignInventory, useDelinkInventory } from "../../hooks/api/designs"
import { useNavigate } from "react-router-dom"

interface DesignInventorySectionProps {
  design: AdminDesign
}

export const DesignInventorySection = ({ design }: DesignInventorySectionProps) => {
  const navigate = useNavigate()
  const { data, isLoading } = useDesignInventory(design.id)
  const { mutateAsync: delinkInventory, isPending: isDelinking } = useDelinkInventory(design.id)

  const inventoryItems: LinkedInventoryItem[] = data?.inventory_items || []

  const handleRemoveInventory = async (inventoryId: string) => {
    console.log("Attempting to remove inventory:", inventoryId)
    try {
      const result = await delinkInventory({
        inventoryIds: [inventoryId],
      })
      console.log("Delink result:", result)
      toast.success("Inventory item removed successfully")
    } catch (error) {
      console.error("Error removing inventory:", error)
      toast.error(error instanceof Error ? error.message : "Failed to remove inventory item")
    }
  }


  const handleOpenDetails = (inventoryId: string | undefined) => {
    if (!inventoryId) {
      return
    }
    navigate(`/designs/${design.id}/inventory/${inventoryId}`)
  }

  const renderInventoryCard = (item: LinkedInventoryItem) => {
    const inventory = (item.inventory_item || {}) as {
      id?: string
      title?: string
      sku?: string
      [key: string]: any
    }
    const inventoryId = item.inventory_item_id || inventory.id
    
    return (
      <div
        key={inventoryId || Math.random()}
        className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="text-ui-fg-base font-medium">
                {inventory.title || inventoryId || "Inventory Item"}
              </span>
              <span className="text-ui-fg-subtle text-sm">{inventory.sku || "–"}</span>
              {inventoryId && (
                <span className="text-ui-fg-subtle text-xs truncate max-w-[150px] sm:max-w-[200px] md:max-w-full block">
                  {inventoryId}
                </span>
              )}
            </div>
            <div className="flex items-center gap-x-1">
              {inventoryId && (
                <button
                  onClick={() => handleOpenDetails(inventoryId)}
                  className="size-7 flex items-center justify-center text-ui-fg-muted hover:text-ui-fg-subtle transition-colors"
                  title="View link details"
                >
                  <InformationCircle className="size-5" />
                </button>
              )}
              {inventoryId && (
                <button
                  onClick={() => handleRemoveInventory(inventoryId)}
                  disabled={isDelinking}
                  className="size-7 flex items-center justify-center text-ui-fg-muted hover:text-ui-fg-subtle transition-colors disabled:opacity-50"
                  title="Remove inventory item"
                >
                  <Trash className="size-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

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
                    navigate(`/designs/${design.id}/addinv`)
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
        <div className="txt-small flex flex-col gap-3 px-3 pb-4">
          {!inventoryItems.length ? (
            <div className="flex items-center justify-center py-4 w-full">
              <Text className="text-ui-fg-subtle">No inventory items linked</Text>
            </div>
          ) : (
            inventoryItems.map((item) => renderInventoryCard(item))
          )}
        </div>
      )}
    </Container>
  )
}
