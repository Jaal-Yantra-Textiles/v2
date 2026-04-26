import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { CreatePartnerFeedbackForm } from "../../../../components/creates/create-partner-feedback";

export default function AddPartnerFeedbackPage() {
  const { id } = useParams();

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Add Partner Feedback</Heading>
      </RouteDrawer.Header>
      <CreatePartnerFeedbackForm partnerId={id!} />
    </RouteDrawer>
  );
}
