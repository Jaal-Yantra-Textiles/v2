import { useParams } from "react-router-dom";
import { useEmailTemplate } from "../../../../../hooks/api/email-templates";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditEmailTemplateForm } from "../../../../../components/edits/edit-email-template";

export default function EditEmailTemplatePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { emailTemplate: emailTemplate, isLoading } = useEmailTemplate(id!, {
    undefined,
  });

  const ready = !!emailTemplate;

  if (isLoading || !emailTemplate) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("emailTemplate.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditEmailTemplateForm emailTemplate={emailTemplate} />}
    </RouteDrawer>
  );
}
