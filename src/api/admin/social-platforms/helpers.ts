import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your social_platform entity
export type SocialPlatformAllowedFields = string[];

export const refetchSocialPlatform = async (
  id: string,
  scope: MedusaContainer,
  fields: SocialPlatformAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: socialplatforms } = await query.graph({
    entity: "social_platform",
    filters: { id },
    fields,
  });

  if (!socialplatforms?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'SocialPlatform with id "' + id + '" not found'
    );
  }

  return socialplatforms[0];
};
