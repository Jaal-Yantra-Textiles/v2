import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { RawMaterialForm } from "../../../../../components/forms/raw-material/raw-material-form"

// Add a color to a group with the full material-spec form (reuses the shared
// RawMaterialForm in "group" mode — the group endpoint provisions the item).
export default function CreateGroupColorPage() {
  const { id } = useParams()
  return (
    <RouteFocusModal prev={`/raw-material-groups/${id}`}>
      <RawMaterialForm mode="group" groupId={id} />
    </RouteFocusModal>
  )
}
