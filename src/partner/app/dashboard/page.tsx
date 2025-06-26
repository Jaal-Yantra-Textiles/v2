import { getDetails } from "./actions"
import Setup from "../components/setup/setup"

export default async function Dashboard() {
  const partner = await getDetails()

  // If the partner is not verified and their status is pending, show the setup guide.
  if (partner && partner.status === "pending" && !partner.is_verified) {
    return <Setup />
  }

  return (
    <div>
      Partner dashboard – you’re logged in.
      {/* The main dashboard content for verified partners will go here */}
    </div>
  )
}
