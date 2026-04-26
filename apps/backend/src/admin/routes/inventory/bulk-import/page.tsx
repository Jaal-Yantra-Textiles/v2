import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquareTwoStack } from "@medusajs/icons"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { InventoryBulkImport } from "../../../components/inventory/bulk-import/inventory-bulk-import"

const BulkImportInventoryPage = () => {
  return (
    <RouteFocusModal>
      <InventoryBulkImport />
    </RouteFocusModal>
  )
}

export default BulkImportInventoryPage

export const config = defineRouteConfig({
  label: "Import Inventory",
  nested: "/inventory",
  icon: SquareTwoStack,
})
