import { RouteFocusModal } from "../../../components/modals"
import { DesignCreateForm } from "./components/design-create-form"

export function DesignCreate() {
  return (
    <RouteFocusModal>
      <DesignCreateForm />
    </RouteFocusModal>
  )
}
