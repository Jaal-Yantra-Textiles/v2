import { useLocation } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer";
import { EditFeedbackForm } from "../../../../../../components/edits/edit-feedback";
import { useFeedback } from "../../../../../../hooks/api/feedbacks";

export default function EditInventoryOrderFeedbackPage() {
  const location = useLocation();
  const feedbackId = location.state?.feedbackId;
  const { feedback, isPending } = useFeedback(feedbackId!);

  if (isPending || !feedback) {
    return null;
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Order Feedback</Heading>
      </RouteDrawer.Header>
      <EditFeedbackForm feedback={feedback} />
    </RouteDrawer>
  );
}
