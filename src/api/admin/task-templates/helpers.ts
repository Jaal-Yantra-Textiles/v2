import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils";

export type TaskTemplateAllowedFields =
  | "id"
  | "name"
  | "description"
  | "category"
  | "category_id"
  | "estimated_duration"
  | "priority"
  | "required_fields"
  | "eventable"
  | "notifiable"
  | "message_template"
  | "metadata"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "*"
  | "category.*"
  | "category.id"
  | "category.name"
  | "category.description"
  | "category.metadata"
  | "category.created_at"
  | "category.updated_at"
  | "category.deleted_at";

export const refetchTaskTemplate = async (
  templateId: string,
  scope: MedusaContainer,
  fields: string[] | TaskTemplateAllowedFields[] = ["*","category.*" ],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.QUERY);
  const templates = await remoteQuery.graph({
    entity: 'task_templates',
    filters: {
      id: templateId
    },
    fields: fields
  });
  return templates.data[0];
};
