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
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: blocks } = await remoteQuery.graph({
    entity: "blocks",
    filters: { 
      id: blockId
    },
    fields: fields,
  });
  return blocks[0];
};
