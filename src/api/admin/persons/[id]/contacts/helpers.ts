import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type ContactAllowedFields =
  | "id"
  | "type"
  | "phone_number"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*";

export const refetchPersonContact = async (
  personId: string,
  contactId: string,
  scope: MedusaContainer,
  fields: ContactAllowedFields[] = ["*"],
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
      "contact_details.*",
      ...fields.map(field => `contact_details.${field}`),
    ],
  });

  const persons = await remoteQuery(queryObject);
  return persons[0]?.contact_details?.find(contact => contact.id === contactId);
};
