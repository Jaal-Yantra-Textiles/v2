import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your payment_report entity
export type Payment_reportAllowedFields = string[];

export const refetchPayment_report = async (
  id: string,
  scope: MedusaContainer,
  fields: Payment_reportAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: payment_reports } = await query.graph({
    entity: "payment_report",
    filters: { id },
    fields,
  });

  if (!payment_reports?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'Payment_report with id "' + id + '" not found'
    );
  }

  return payment_reports[0];
};
