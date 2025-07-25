import { useUpdateEmailTemplate } from "../../hooks/api/email-templates";
import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AdminEmailTemplate } from "../../hooks/api/email-templates";
import { useRouteModal } from "../../components/modal/use-route-modal";

type EditEmailTemplateFormProps = {
  emailTemplate: AdminEmailTemplate;
};

export const EditEmailTemplateForm = ({ emailTemplate }: EditEmailTemplateFormProps) => {
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useUpdateEmailTemplate(emailTemplate.id);
  const { handleSuccess } = useRouteModal();

  const handleSubmit = async (data: any) => {
    try {
      await mutateAsync(data);
      toast.success("EmailTemplate updated successfully");
      handleSuccess();
    } catch (error) {
      toast.error("Failed to update emailTemplate");
    }
  };

  const fields: FieldConfig<any>[] = [
    {
      name: "name",
      type: "text", 
      label: "Name", 
      required: true
    },
    {
      name: "description",
      type: "text", 
      label: "Description", 
      required: false
    },
    {
      name: "to",
      type: "text", 
      label: "To", 
      required: false
    },
    {
      name: "cc",
      type: "text", 
      label: "Cc", 
      required: false
    },
    {
      name: "bcc",
      type: "text", 
      label: "Bcc", 
      required: false
    },
    {
      name: "from",
      type: "text", 
      label: "From", 
      required: true
    },
    {
      name: "templateKey",
      type: "text", 
      label: "Template Key", 
      required: true
    },
    {
      name: "subject",
      type: "text", 
      label: "Subject", 
      required: true
    },
    {
      name: "isActive",
      type: "switch", 
      label: "Is Active", 
      required: true
    },
    {
      name: "templateType",
      type: "text", 
      label: "Template Type", 
      required: true
    },
  ];

  return (
    <DynamicForm<any>
      fields={fields}
      defaultValues={{
        name: emailTemplate.name || "",
        description: emailTemplate.description || "",
        to: emailTemplate.to || "",
        cc: emailTemplate.cc || "",
        bcc: emailTemplate.bcc || "",
        from: emailTemplate.from || "",
        templateKey: emailTemplate.templateKey || "",
        subject: emailTemplate.subject || "",
        isActive: emailTemplate.isActive || false,
        templateType: emailTemplate.templateType || "",
      }}
      onSubmit={handleSubmit}
      layout={{
        showDrawer: true,
        gridCols: 1,
      }}
      isPending={isPending}
    />
  );
};
