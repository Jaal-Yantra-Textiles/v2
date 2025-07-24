import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// EmailTemplate entity fields
export type EmailTemplateAllowedFields = (
  | "id"
  | "name"
  | "description"
  | "to"
  | "from"
  | "template_key"
  | "subject"
  | "html_content"
  | "variables"
  | "is_active"
  | "template_type"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*"
)[];

export const refetchEmailTemplate = async (
  id: string,
  scope: MedusaContainer,
  fields: EmailTemplateAllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: emailtemplates } = await query.graph({
    entity: "email_templates",
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
