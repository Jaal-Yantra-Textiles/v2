import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type AddressAllowedFields =
  | "id"
  | "street"
  | "city"
  | "state"
  | "postal_code"
  | "country"
  | "metadata"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*";

export const refetchPersonAddress = async (
  personId: string,
  addressId: string,
  scope: MedusaContainer,
  fields: AddressAllowedFields[] = ["*"],
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
      "addresses.*",
      ...fields.map(field => `addresses.${field}`),
    ],
  });

  const persons = await remoteQuery(queryObject);
  return persons[0]?.addresses?.find(addr => addr.id === addressId);
};
