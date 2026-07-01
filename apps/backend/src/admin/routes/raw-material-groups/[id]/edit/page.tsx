import { useParams } from "react-router-dom"
import { useRawMaterialGroup } from "../../../../hooks/api/raw-material-groups"
import { EditGroupForm } from "../../../../components/raw-material-groups/edit-group-form"

// Route drawer for editing a Material Group's global specs (#829).
export default function EditRawMaterialGroupPage() {
  const { id } = useParams()
  const { data, isLoading } = useRawMaterialGroup(id)
  const group = data?.raw_material_group

  if (isLoading || !group) {
    return null
  }

  return <EditGroupForm group={group} />
}
