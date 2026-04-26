import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your email_template entity
export type EmailTemplateAllowedFields = string[];

export const refetchEmailTemplate = async (
  id: string,
  scope: MedusaContainer,
  fields: EmailTemplateAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: emailtemplates } = await query.graph({
    entity: "email_template",
    filters: { id },
    fields,
  });

  if (!emailtemplates?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'EmailTemplate with id "' + id + '" not found'
    );
  }

  return emailtemplates[0];
};
