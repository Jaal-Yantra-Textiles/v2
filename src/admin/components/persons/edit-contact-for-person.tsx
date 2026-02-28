import { useTranslation } from "react-i18next";
import { z } from "@medusajs/framework/zod";
import { toast } from "sonner";
import { Select } from "@medusajs/ui";

import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import {
  ContactDetail,
  useUpdatePersonContact,
} from "../../hooks/api/person-contacts";

const EditPersonContactSchema = z.object({
  phone_number: z.string().min(1, "Phone number is required"),
  type: z.enum(["mobile", "home", "work"]),
});

type TEditPersonContactSchema = z.infer<typeof EditPersonContactSchema>;

const ContactTypeField = ({ value, onChange }: any) => {
  const { t } = useTranslation();
  return (
    <Select onValueChange={onChange} value={value}>
      <Select.Trigger>
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="mobile">{t("fields.mobile")}</Select.Item>
        <Select.Item value="home">{t("fields.home")}</Select.Item>
        <Select.Item value="work">{t("fields.work")}</Select.Item>
      </Select.Content>
    </Select>
  );
};

type EditContactForPersonFormProps = {
  personId: string;
  contact: ContactDetail;
};

export const EditContactForPersonForm = ({
  personId,
  contact,
}: EditContactForPersonFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdatePersonContact(personId, contact.id);

  const handleSubmit = async (data: TEditPersonContactSchema) => {
    await mutateAsync(data, {
      onSuccess: () => {
        toast.success(t("contact.toast.updated"));
        handleSuccess();
      },
      onError: (err: Error) => {
        toast.error(err.message);
      },
    });
  };

  const fields: FieldConfig<TEditPersonContactSchema>[] = [
    {
      name: "phone_number",
      type: "text",
      label: t("fields.phone_number"),
      required: true,
    },
    {
      name: "type",
      type: "custom",
      label: t("fields.type"),
      required: true,
      customComponent: ContactTypeField,
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        phone_number: contact.phone_number,
        type: contact.type,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 2 }}
    />
  );
};
