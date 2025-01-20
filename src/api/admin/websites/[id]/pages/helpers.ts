import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils";

export type PageAllowedFields =
  | "id"
  | "title"
  | "slug"
  | "content"
  | "page_type"
  | "status"
  | "meta_title"
  | "meta_description"
  | "meta_keywords"
  | "published_at"
  | "last_modified"
  | "metadata"
  | "website_id"
  | "created_at"
  | "updated_at"
  | "*"
  | "deleted_at";

export const refetchPage = async (
  pageId: string,
  websiteId: string,
  scope: MedusaContainer,
  fields: PageAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: pages } = await remoteQuery.graph({
    entity: "pages",
    filters: { id: pageId},
    fields: ['*'],
  });

  return pages[0];
};
