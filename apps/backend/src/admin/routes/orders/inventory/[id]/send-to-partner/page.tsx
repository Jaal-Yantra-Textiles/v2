import { useParams } from "react-router-dom"
import { SendToPartnerForm } from "../../../../../components/forms/send-to-partner/send-to-partner-form"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"

const InventoryOrderSendToPartnerPage = () => {
  const { id } = useParams()


  return (
    <RouteFocusModal>
    <SendToPartnerForm 
      entityId={id}
      entityType="inventory order"
    />
    </RouteFocusModal>
  )
}

export default InventoryOrderSendToPartnerPage
