import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { useRouteModal } from "../../components/modal/use-route-modal";
import { AdminAgreement, useUpdateAgreement } from "../../hooks/api/agreement";

type EditAgreementFormProps = {
  agreement: AdminAgreement;
};

export const EditAgreementForm = ({ agreement }: EditAgreementFormProps) => {
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useUpdateAgreement(agreement.id);
  const { handleSuccess } = useRouteModal();

  const handleSubmit = async (data: any) => {
    try {
      await mutateAsync(data);
      toast.success("Agreement updated successfully");
      handleSuccess();
    } catch (error) {
      toast.error("Failed to update agreement");
    }
  };

  const fields: FieldConfig<any>[] = [
    {
      name: "title",
      type: "text", 
      label: "Title", 
      required: true
    },
    {
      name: "content",
      type: "text", 
      label: "Content", 
      required: true
    },
    {
      name: "templateKey",
      type: "text", 
      label: "Template Key", 
      required: false
    },
    {
      name: "optional",
      type: "text", 
      label: "Optional", 
      required: true
    },
    {
      name: "status",
      type: "text", 
      label: "Status", 
      required: true
    },
    {
      name: "validFrom",
      type: "text", 
      label: "Valid From", 
      required: false
    },
    {
      name: "validUntil",
      type: "text", 
      label: "Valid Until", 
      required: false
    },
    {
      name: "subject",
      type: "text", 
      label: "Subject", 
      required: true
    },
    {
      name: "fromEmail",
      type: "text", 
      label: "From Email", 
      required: false
    },
    {
      name: "sentCount",
      type: "number", 
      label: "Sent Count", 
      required: true
    },
    {
      name: "responseCount",
      type: "number", 
      label: "Response Count", 
      required: true
    },
    {
      name: "agreedCount",
      type: "number", 
      label: "Agreed Count", 
      required: true
    },
    {
      name: "metadata",
      type: "text", 
      label: "Metadata", 
      required: false
    },
    {
      name: "responses",
      type: "text", 
      label: "Responses", 
      required: true
    },
    {
      name: "mappedBy",
      type: "text", 
      label: "MappedBy", 
      required: true
    },
  ];

  return (
    <DynamicForm<any>
      fields={fields}
      defaultValues={{
        title: agreement.title || "",
        content: agreement.content || "",
        templateKey: agreement.templateKey || "",
        optional: agreement.optional || "",
        status: agreement.status || "",
        validFrom: agreement.validFrom || "",
        validUntil: agreement.validUntil || "",
        subject: agreement.subject || "",
        fromEmail: agreement.fromEmail || "",
        sentCount: agreement.sentCount || 0,
        responseCount: agreement.responseCount || 0,
        agreedCount: agreement.agreedCount || 0,
        metadata: agreement.metadata || "",
        responses: agreement.responses || "",
        mappedBy: agreement.mappedBy || "",
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
