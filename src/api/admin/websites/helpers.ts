import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type WebsiteAllowedFields =
  | "id"
  | "domain"
  | "name"
  | "description"
  | "status"
  | "primary_language"
  | "supported_languages"
  | "favicon_url"
  | "analytics_id"
  | "metadata"
  | "created_at"
  | "updated_at"
  | "*"
  | "deleted_at";

export const refetchWebsite = async (
  websiteId: string,
  scope: MedusaContainer,
  fields: WebsiteAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "websites",
    variables: {
      filters: { id: websiteId },
    },
    fields: ["*"],
  });

  const websites = await remoteQuery(queryObject);

  return websites[0];
};
