import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your feedback entity
export type FeedbackAllowedFields = string[];

export const refetchFeedback = async (
  id: string,
  scope: MedusaContainer,
  fields: FeedbackAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: feedbacks } = await query.graph({
    entity: "feedback",
    filters: { id },
    fields,
  });

  if (!feedbacks?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'Feedback with id "' + id + '" not found'
    );
  }

  return feedbacks[0];
};
