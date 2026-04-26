import { useInventoryOrderFeedbacks } from "../../hooks/api/feedbacks";
import { FeedbackListSection } from "../feedbacks/feedback-list-section";

type InventoryOrderFeedbacksSectionProps = {
  orderId: string;
};

export const InventoryOrderFeedbacksSection = ({
  orderId,
}: InventoryOrderFeedbacksSectionProps) => {
  const { feedbacks, count, isPending } = useInventoryOrderFeedbacks(orderId);

  return (
    <FeedbackListSection
      feedbacks={feedbacks}
      count={count}
      isPending={isPending}
      entityId={orderId}
      entityType="inventory-order"
      title="Order Feedback"
    />
  );
};
