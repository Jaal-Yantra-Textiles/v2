import { SendToPartnerForm } from "../../components/forms/send-to-partner/send-to-partner-form"

export default function SendToPartnerPage() {
  const handleSend = async (partnerIds: string[]) => {
    // This would be implemented based on the specific use case
    // For example, sending an email, creating notifications, etc.
    console.log("Sending to partners:", partnerIds)
    
    // Example implementation:
    // await sendNotificationToPartners(partnerIds, entityId, entityType)
  }

  return (
    <SendToPartnerForm 
      entityId="example-id"
      entityType="inventory order"
      onSend={handleSend}
    />
  )
}
