import { AdminEmailTemplate } from "../../hooks/api/email-templates";
import { EmailTemplateEditorSection } from "../email-templates/email-template-editor-section";
import { RouteFocusModal } from "../modal/route-focus-modal";

export const EditEmailTemplateContentSection = ({ emailTemplate }: { emailTemplate: AdminEmailTemplate }) => {
  return (
    <RouteFocusModal>
      <EmailTemplateEditorSection emailTemplate={emailTemplate} />
    </RouteFocusModal>
  );
};
