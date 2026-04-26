import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type PersonAllowedFields =
  | "id"
  | "first_name"
  | "last_name"
  | "email"
  | "date_of_birth"
  | "metadata"
  | "avatar"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*"
  | "addresses.country"
  | "addresses.id"
  | "contact_details.person.*";

export const refetchPerson = async (
  personId: string,
  scope: MedusaContainer,
  fields: PersonAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "person",
    variables: {
      filters: { id: personId },
    },
    fields: fields,
  });

  const persons = await remoteQuery(queryObject);
  return persons[0];
};
