import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your agreement entity
export type AgreementAllowedFields = string[];

export const refetchAgreement = async (
  id: string,
  scope: MedusaContainer,
  fields: AgreementAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: agreements } = await query.graph({
    entity: "agreement",
    filters: { id },
    fields,
  });

  if (!agreements?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'Agreement with id "' + id + '" not found'
    );
  }

  return agreements[0];
};
