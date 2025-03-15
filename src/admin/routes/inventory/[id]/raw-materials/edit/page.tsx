import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next";
import { useInventoryItem } from "../../../../../hooks/api/raw-materials";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditRawMaterialForm } from "../../../../../components/edits/edit-raw-material";
export default function EditRawMaterialPage() {
 
  const { id } = useParams();
  const { t } = useTranslation();
  const { inventory_item , isLoading , isError, error} = useInventoryItem(id!, {
    fields: "+raw_materials.*, +raw_materials.material_type.*"
  })

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("raw_material.edit.header")}</Heading>
      </RouteDrawer.Header>
      {!isLoading && inventory_item && inventory_item.raw_materials && (
        <EditRawMaterialForm 
          rawMaterial={inventory_item.raw_materials} 
        />
      )}
    </RouteDrawer>
  )
}
