import { Badge, Text } from "@medusajs/ui";
import { Link } from "react-router-dom";
import { AdminFeedback } from "../../hooks/api/feedbacks";
import { format } from "date-fns";

type FeedbackItemProps = {
  feedback: AdminFeedback;
  editRoute: string;
};

const getRatingStars = (rating: string) => {
  const ratingMap = {
    one: "⭐",
    two: "⭐⭐",
    three: "⭐⭐⭐",
    four: "⭐⭐⭐⭐",
    five: "⭐⭐⭐⭐⭐",
  };
  return ratingMap[rating as keyof typeof ratingMap] || rating;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "pending":
      return "orange";
    case "reviewed":
      return "blue";
    case "resolved":
      return "green";
    default:
      return "grey";
  }
};

export const FeedbackItem = ({ feedback, editRoute }: FeedbackItemProps) => {
  return (
    <Link
      to={editRoute}
      state={{ feedbackId: feedback.id }}
      className="flex flex-col gap-y-2 p-4 border-b border-ui-border-base last:border-b-0 hover:bg-ui-bg-subtle-hover transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex items-center gap-x-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {getRatingStars(feedback.rating)}
          </Text>
          <Badge size="2xsmall" color={getStatusColor(feedback.status)}>
            {feedback.status}
          </Badge>
        </div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {format(new Date(feedback.submitted_at), "MMM d, yyyy")}
        </Text>
      </div>

      {feedback.comment && (
        <Text size="small" className="text-ui-fg-base line-clamp-2">
          {feedback.comment}
        </Text>
      )}

      <div className="flex items-center gap-x-4 text-ui-fg-subtle">
        <Text size="xsmall">
          <span className="font-medium">By:</span> {feedback.submitted_by}
        </Text>
        {feedback.reviewed_by && (
          <Text size="xsmall">
            <span className="font-medium">Reviewed by:</span> {feedback.reviewed_by}
          </Text>
        )}
      </div>
    </Link>
  );
};
