import { Badge, Container, Heading, Text } from "@medusajs/ui";
import { ChatBubbleLeftRight } from "@medusajs/icons";
import { AdminFeedback } from "../../hooks/api/feedbacks";
import { ActionMenu } from "../common/action-menu";
import { FeedbackItem } from "./feedback-item";

type FeedbackListSectionProps = {
  feedbacks?: AdminFeedback[];
  count?: number;
  isPending?: boolean;
  entityId: string;
  entityType: "partner" | "task" | "inventory-order";
  title?: string;
};

export const FeedbackListSection = ({
  feedbacks,
  count,
  isPending,
  entityId,
  entityType,
  title = "Feedback",
}: FeedbackListSectionProps) => {
  const feedbackCount = isPending ? 0 : count || feedbacks?.length || 0;

  // Determine the add feedback route based on entity type
  const getAddFeedbackRoute = () => {
    switch (entityType) {
      case "partner":
        return `/partners/${entityId}/add-feedback`;
      case "task":
        return `/tasks/${entityId}/add-feedback`;
      case "inventory-order":
        return `/inventory/orders/${entityId}/add-feedback`;
      default:
        return "#";
    }
  };

  // Determine the edit feedback route based on entity type
  const getEditFeedbackRoute = () => {
    return `feedbacks/edit`;
  };

  return (
    <Container className="divide-y p-0 w-full">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">{title}</Heading>
          {feedbackCount > 0 && (
            <Badge size="2xsmall" className="ml-2">
              {feedbackCount}
            </Badge>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Add Feedback",
                  icon: <ChatBubbleLeftRight />,
                  to: getAddFeedbackRoute(),
                },
              ],
            },
          ]}
        />
      </div>

      <div className="divide-y">
        {isPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading feedback...
            </Text>
          </div>
        ) : feedbackCount === 0 ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No feedback yet. Be the first to add feedback!
            </Text>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {feedbacks?.map((feedback) => (
              <FeedbackItem
                key={feedback.id}
                feedback={feedback}
                editRoute={getEditFeedbackRoute()}
              />
            ))}
          </div>
        )}
      </div>
    </Container>
  );
};
