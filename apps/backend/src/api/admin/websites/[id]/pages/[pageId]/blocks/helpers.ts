import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export type BlockAllowedFields =
  | "id"
  | "name"
  | "type"
  | "content"
  | "settings"
  | "order"
  | "status"
  | "metadata"
  | "page_id"
  | "created_at"
  | "updated_at"
  | "*"
  | "deleted_at"
  | "page";

 
export const refetchBlock = async (
  blockId: string,
  pageId: string,
  scope: MedusaContainer,
  fields: BlockAllowedFields[] = ["*"],
) => {
  // Hard guard: a falsy `blockId` used to flow into the query as
  // `filters: { id: undefined }`, returning an arbitrary first row —
  // that's how a PUT could 200 with a completely unrelated block in
  // the response body. Same shape as the `refetchPage` guard added
  // in #285.
  if (!blockId || typeof blockId !== "string") {
    throw new Error(
      `refetchBlock called with invalid blockId: ${JSON.stringify(blockId)}`
    );
  }

  const remoteQuery = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: blocks } = await remoteQuery.graph({
    entity: "blocks",
    filters: { id: blockId },
    fields: fields,
  });
  return blocks[0];
};
