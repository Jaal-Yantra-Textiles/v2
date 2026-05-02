import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { ImportTourBookingsComponent } from "../../../../../components/edits/import-tour-bookings"

export default function ImportBookingsPage() {
  const { id } = useParams()
  if (!id) return null

  return (
    <RouteFocusModal>
      <ImportTourBookingsComponent formId={id} />
    </RouteFocusModal>
  )
}
