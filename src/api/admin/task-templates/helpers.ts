import { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";

export type TaskTemplateAllowedFields =
  | "id"
  | "name"
  | "description"
  | "category"
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
  | "category.*";

export const refetchTaskTemplate = async (
  templateId: string,
  scope: MedusaContainer,
  fields: TaskTemplateAllowedFields[] = ["*"],
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "task_template",
    variables: {
      filters: { id: templateId },
    },
    fields: fields,
  });
  const templates = await remoteQuery(queryObject);
  return templates[0];
};
