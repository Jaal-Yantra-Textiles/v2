import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your social_post entity
export type SocialPostAllowedFields = string[];

export const refetchSocialPost = async (
  id: string,
  scope: MedusaContainer,
  fields: SocialPostAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: socialposts } = await query.graph({
    entity: "social_post",
    filters: { id },
    fields,
  });

  if (!socialposts?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'SocialPost with id "' + id + '" not found'
    );
  }

  return socialposts[0];
};
