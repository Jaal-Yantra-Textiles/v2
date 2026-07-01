import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { RawMaterialForm } from "../../../../../components/forms/raw-material/raw-material-form"

export default function CreateRawMaterialPage() {
  const { id } = useParams()
  // Close the create modal straight back to the inventory item. The default
  // `prev` ("..") lands on the parent `/raw-materials` route, which is an edit
  // RouteDrawer that renders an empty form for a brand-new item (#825).
  return (
    <RouteFocusModal prev={`/inventory/${id}`}>
      <RawMaterialForm />
    </RouteFocusModal>
  )
}
