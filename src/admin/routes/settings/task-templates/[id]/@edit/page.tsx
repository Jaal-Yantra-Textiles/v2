import { useParams } from "react-router-dom";
import { useTaskTemplate } from "../../../../../hooks/api/task-templates";
import {  Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditTaskTemplateForm } from "../../../../../components/edits/edit-task-template";


export default function EditTaskTemplatePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { task_template: template, isLoading } = useTaskTemplate(id!, {
    undefined,
  });

  const ready = !!template;

  if (isLoading || !template) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("taskTemplate.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditTaskTemplateForm template={template} />}
    </RouteDrawer>
  );
}
