import { Heading } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useRawMaterialGroup } from "../../../../hooks/api/raw-material-groups"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { EditGroupForm } from "../../../../components/raw-material-groups/edit-group-form"

// Route drawer for editing a Material Group's global specs (#829).
//
// RouteDrawer renders the RouteModalProvider around its CHILDREN, so the form —
// which calls useRouteModal() — must live inside <RouteDrawer>, not wrap it.
// (Wrapping it caused "useRouteModal must be used within a RouteModalProvider".)
export default function EditRawMaterialGroupPage() {
  const { id } = useParams()
  const { data, isLoading } = useRawMaterialGroup(id)
  const group = data?.raw_material_group

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Edit group</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      {!isLoading && group && <EditGroupForm group={group} />}
    </RouteDrawer>
  )
}
