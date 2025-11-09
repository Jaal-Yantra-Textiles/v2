import { usePartnerFeedbacks } from "../../hooks/api/feedbacks";
import { FeedbackListSection } from "../feedbacks/feedback-list-section";

type PartnerFeedbacksSectionProps = {
  partnerId: string;
};

export const PartnerFeedbacksSection = ({ partnerId }: PartnerFeedbacksSectionProps) => {
  const { feedbacks, count, isPending } = usePartnerFeedbacks(partnerId);

  return (
    <FeedbackListSection
      feedbacks={feedbacks}
      count={count}
      isPending={isPending}
      entityId={partnerId}
      entityType="partner"
      title="Partner Feedback"
    />
  );
};
