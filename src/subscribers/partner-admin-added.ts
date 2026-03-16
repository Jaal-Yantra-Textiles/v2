import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendAdminPartnerCreationEmail } from "../workflows/email/send-notification-email"

export default async function partnerAdminAddedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  partner_id: string
  partner_name: string
  admin_email: string
  admin_name: string
  temp_password: string
}>) {
  await sendAdminPartnerCreationEmail(container).run({
    input: {
      to: data.admin_email,
      partner_name: data.partner_name,
      temp_password: data.temp_password,
    },
  })
}

export const config: SubscriberConfig = {
  event: "partner.admin.added",
}
