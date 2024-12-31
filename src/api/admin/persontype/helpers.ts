import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type PersonTypeAllowedFields =
  | "id"
  | "name"
  | "metadata"
  | "created_at"
  | "updated_at"
  | "*"
  | "deleted_at"
  | "description";

export const refetchPersonType = async (
  personTypeId: string,
  scope: MedusaContainer,
  fields: PersonTypeAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "person_types",
    variables: {
      filters: { id: personTypeId },
    },
    fields: ["*"],
  });

  const personTypes = await remoteQuery(queryObject);

  return personTypes[0];
};
