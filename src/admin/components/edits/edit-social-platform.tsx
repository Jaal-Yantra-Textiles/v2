import { useTranslation } from "react-i18next";
import { z } from "@medusajs/framework/zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateSocialPlatform, AdminSocialPlatform } from "../../hooks/api/social-platforms";

const socialPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  base_url: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  category: z.enum(["social", "payment", "shipping", "email", "sms", "analytics", "crm", "storage", "communication", "authentication", "other"]).optional(),
  auth_type: z.enum(["oauth2", "oauth1", "api_key", "bearer", "basic"]).optional(),
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
  icon_url: z.string().url("Must be a valid URL").optional().or(z.literal('')),
});

type SocialPlatformFormData = z.infer<typeof socialPlatformSchema>;

const categoryOptions = [
  { value: "social", label: "Social Media" },
  { value: "payment", label: "Payment" },
  { value: "shipping", label: "Shipping" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "analytics", label: "Analytics" },
  { value: "crm", label: "CRM" },
  { value: "storage", label: "Storage" },
  { value: "communication", label: "Communication" },
  { value: "authentication", label: "Authentication" },
  { value: "other", label: "Other" },
];

const authTypeOptions = [
  { value: "oauth2", label: "OAuth 2.0" },
  { value: "oauth1", label: "OAuth 1.0" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
];

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "error", label: "Error" },
];

type EditSocialPlatformFormProps = {
  socialPlatform: AdminSocialPlatform;
};

export const EditSocialPlatformForm = ({ socialPlatform }: EditSocialPlatformFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateSocialPlatform(socialPlatform.id);

  const handleSubmit = async (data: SocialPlatformFormData) => {
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        base_url: data.base_url,
        category: data.category,
        auth_type: data.auth_type,
        status: data.status,
        icon_url: data.icon_url,
      },
      {
        onSuccess: ({ socialPlatform }) => {
          toast.success(
            `External Platform "${socialPlatform.name}" updated successfully`
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const fields: FieldConfig<SocialPlatformFormData>[] = [
    {
      name: "name",
      type: "text",
      label: t("fields.name"),
      required: true,
    },
    {
      name: "description",
      type: "text",
      label: t("fields.description"),
    },
    {
      name: "base_url",
      type: "text",
      label: "Base URL",
    },
    {
      name: "icon_url",
      type: "text",
      label: "Icon URL",
    },
    {
      name: "category",
      type: "select",
      label: "Category",
      options: categoryOptions,
      gridCols: 1
    },
    {
      name: "auth_type",
      type: "select",
      label: "Authentication Type",
      options: authTypeOptions,
      gridCols: 1
    },
    {
      name: "status",
      type: "select",
      label: t("fields.status"),
      options: statusOptions,
      gridCols: 1
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        name: socialPlatform.name,
        description: socialPlatform.description || "",
        base_url: socialPlatform.base_url || "",
        icon_url: socialPlatform.icon_url || "",
        category: socialPlatform.category,
        auth_type: socialPlatform.auth_type,
        status: socialPlatform.status,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
