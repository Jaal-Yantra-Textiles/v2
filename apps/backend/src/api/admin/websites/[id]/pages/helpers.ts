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
  // Hard guard: a falsy `pageId` used to flow into the query as
  // `filters: { id: undefined }`, which returned an arbitrary first
  // row — that's how a PUT could 200 with a completely unrelated
  // page in the body. Throw early so the caller sees the bug instead
  // of shipping wrong data downstream.
  if (!pageId || typeof pageId !== "string") {
    throw new Error(
      `refetchPage called with invalid pageId: ${JSON.stringify(pageId)}`
    );
  }

  const remoteQuery = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: pages } = await remoteQuery.graph({
    entity: "pages",
    filters: { id: pageId },
    fields: fields.length ? (fields as string[]) : ["*"],
  });

  return pages[0];
};
