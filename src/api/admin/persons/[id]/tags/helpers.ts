import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type TagAllowedFields =
  | "id"
  | "tags"
  | "name"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*";

export const refetchPersonTags = async (
  personId: string,
  scope: MedusaContainer,
  fields: TagAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "person",
    variables: {
      filters: { 
        id: personId,
      },      
    },
    fields: [
      "tags.*",
      ...fields.map(field => `tags.${field}`),
    ],
  });
  const persons = await remoteQuery(queryObject);
  console.log("TagsForPerson",persons)
  return persons[0]?.tags || [];
};
