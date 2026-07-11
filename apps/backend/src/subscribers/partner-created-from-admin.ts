import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendAdminPartnerCreationEmail } from "../workflows/email/send-notification-email"

export default async function partnerCreatedFromAdminHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  partner_id: string
  partner_admin_id: string
  email: string
  temp_password: string
}>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch partner to get display name
  let partnerName = "Partner"
  let preferredLanguage: string | undefined
  try {
    const result = await query.graph({
      entity: "partners",
      fields: ["*"],
      filters: { id: data.partner_id },
    })
    const partners = result.data || []
    if (partners.length) {
      partnerName = partners[0].name || partnerName
    }
  } catch (e) {
    // Fallback to default if query fails
  }

  // Fetch partner admin to get preferred language
  try {
    const result = await query.graph({
      entity: "partner_admin",
      fields: ["preferred_language"],
      filters: { id: data.partner_admin_id },
    })
    const admins = result.data || []
    if (admins.length && admins[0].preferred_language) {
      preferredLanguage = admins[0].preferred_language
    }
  } catch (e) {
    // Fallback to English if query fails
  }

  // Send the onboarding email using the workflow
  await sendAdminPartnerCreationEmail(container).run({
    input: {
      to: data.email,
      partner_name: partnerName,
      temp_password: data.temp_password,
      locale: preferredLanguage,
    },
  })
}

export const config: SubscriberConfig = {
  event: "partner.created.fromAdmin",
}
