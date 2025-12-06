import { useParams } from "react-router-dom"
import { Heading } from "@medusajs/ui"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useCampaign } from "../../../../hooks/api/publishing-campaigns"
import { EditCampaignForm } from "../../../../components/edits/edit-campaign"

export default function EditCampaignPage() {
  const { id } = useParams()
  const { data: campaign, isLoading } = useCampaign(id!)

  if (isLoading || !campaign) {
    return null
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Campaign</Heading>
      </RouteDrawer.Header>
      <EditCampaignForm campaign={campaign} />
    </RouteDrawer>
  )
}
