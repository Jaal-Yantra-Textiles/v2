import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your payment entity
export type PaymentAllowedFields = string[];

export const refetchPayment = async (
  id: string,
  scope: MedusaContainer,
  fields: PaymentAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: payments } = await query.graph({
    entity: "payment",
    filters: { id },
    fields,
  });

  if (!payments?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'Payment with id "' + id + '" not found'
    );
  }

  return payments[0];
};
