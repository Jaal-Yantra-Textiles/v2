import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { RawMaterialForm } from "../../../../../components/forms/raw-material/raw-material-form"

export default function CreateRawMaterialPage() {
  const { id } = useParams()
  // Close (X / Esc) must return to the inventory item, NOT the default ".."
  // — this route is nested under the raw-materials EDIT drawer, so ".." would
  // land on that drawer rendered with an empty state (no raw material exists
  // for a brand-new item yet). Matches the form's own success/cancel target.
  return (
    <RouteFocusModal prev={`/inventory/${id}`}>
      <RawMaterialForm />
    </RouteFocusModal>
  )
}
