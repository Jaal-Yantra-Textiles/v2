import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your analytics_event entity
export type AnalyticsEventAllowedFields = string[];

export const refetchAnalyticsEvent = async (
  id: string,
  scope: MedusaContainer,
  fields: AnalyticsEventAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: analyticsevents } = await query.graph({
    entity: "analytics_event",
    filters: { id },
    fields,
  });

  if (!analyticsevents?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'AnalyticsEvent with id "' + id + '" not found'
    );
  }

  return analyticsevents[0];
};
