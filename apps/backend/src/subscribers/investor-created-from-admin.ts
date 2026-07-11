import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendAdminInvestorCreationEmail } from "../workflows/email/send-notification-email"

export default async function investorCreatedFromAdminHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  investor_id: string
  investor_admin_id: string
  email: string
  temp_password: string
}>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  let investorName = "Investor"
  try {
    const result = await query.graph({
      entity: "investors",
      fields: ["*"],
      filters: { id: data.investor_id },
    })
    const investors = result.data || []
    if (investors.length) {
      investorName = investors[0].name || investorName
    }
  } catch (e) {
    // Fallback to default if query fails
  }

  await sendAdminInvestorCreationEmail(container).run({
    input: {
      to: data.email,
      investor_name: investorName,
      temp_password: data.temp_password,
      login_url: process.env.INVESTOR_UI_URL || "https://invest.jaalyantra.com",
    },
  })
}

export const config: SubscriberConfig = {
  event: "investor.created.fromAdmin",
}
