import { useParams } from "react-router-dom";
import { Heading, Skeleton } from "@medusajs/ui"
import { useTranslation } from "react-i18next";
import { useInventoryItem } from "../../../../../hooks/api/raw-materials";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditRawMaterialForm } from "../../../../../components/edits/edit-raw-material";
export default function EditRawMaterialPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { inventory_item , isLoading } = useInventoryItem(id!)
  if (isLoading || !inventory_item?.raw_materials) {
    return <Skeleton></Skeleton>
  }
  return (

    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("raw_material.edit.header")}</Heading>
      </RouteDrawer.Header>
      <EditRawMaterialForm rawMaterial={inventory_item?.raw_materials}/>
    </RouteDrawer>
  )
}
