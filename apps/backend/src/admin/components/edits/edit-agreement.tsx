import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { toast } from "@medusajs/ui";
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
      required: true,
    },
    {
      name: "subject",
      type: "text",
      label: "Subject",
      required: true,
    },
    {
      name: "status",
      type: "select",
      label: "Status",
      required: true,
      options: [
        { label: "Draft", value: "draft" },
        { label: "Active", value: "active" },
        { label: "Expired", value: "expired" },
        { label: "Cancelled", value: "cancelled" },
      ],
    },
    {
      name: "template_key",
      type: "text",
      label: "Template Key",
      required: false,
    },
    {
      name: "valid_from",
      type: "text",
      label: "Valid From",
      required: false,
    },
    {
      name: "valid_until",
      type: "text",
      label: "Valid Until",
      required: false,
    },
    {
      name: "from_email",
      type: "text",
      label: "From Email",
      required: false,
    },
  ];

  return (
    <DynamicForm<any>
      fields={fields}
      defaultValues={{
        title: agreement.title || "",
        subject: agreement.subject || "",
        status: agreement.status || "draft",
        template_key: agreement.template_key || "",
        valid_from: agreement.valid_from || "",
        valid_until: agreement.valid_until || "",
        from_email: agreement.from_email || "",
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
