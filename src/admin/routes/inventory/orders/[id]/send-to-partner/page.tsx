import { useParams } from "react-router-dom"
import { SendToPartnerForm } from "../../../../../components/forms/send-to-partner/send-to-partner-form"

const InventoryOrderSendToPartnerPage = () => {
  const { id } = useParams()

  const handleSend = async (partnerIds: string[]) => {
    // TODO: Implement the actual send logic
    // This could involve creating a workflow to send the inventory order to selected partners
    console.log("Sending inventory order", id, "to partners:", partnerIds)
    
    // For now, just simulate success
    return Promise.resolve()
  }

  return (
    <SendToPartnerForm 
      entityId={id}
      entityType="inventory order"
      onSend={handleSend}
    />
  )
}

export default InventoryOrderSendToPartnerPage
