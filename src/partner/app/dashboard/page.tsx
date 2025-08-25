import { getDetails } from "./actions"
import Setup from "../components/setup/setup"
import { redirect } from "next/navigation"

export default async function Dashboard() {
  const partner = await getDetails()

  // If the partner is not verified and their status is pending, show the setup guide.
  if (partner && partner.status === "pending" && !partner.is_verified) {
    return <Setup partnerId={partner.id} />
  }

  // Otherwise, redirect to inventory orders as the default landing page
  redirect("/dashboard/inventory-orders")
}
