import { useTranslation } from "react-i18next";
import { z } from "@medusajs/framework/zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateSocialPlatform, AdminSocialPlatform } from "../../hooks/api/social-platforms";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Heading, Input, Select, Textarea, Text } from "@medusajs/ui";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { CategoryProviderFields, hasProviderFields } from "../social-platforms/category-provider-fields";
import { buildApiConfig, inferAuthType, getFormDefaultsFromApiConfig } from "../social-platforms/api-config";

const socialPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  base_url: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  category: z.enum(["social", "payment", "shipping", "email", "sms", "analytics", "crm", "storage", "communication", "authentication", "google", "other"]).optional(),
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
  { value: "google", label: "Google Business Manager" },
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

// Category-specific edit schema (relaxed validation — secrets not required on edit)
const categoryPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
  provider_type: z.string().optional(),
  // All possible category fields (optional on edit)
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  tls: z.boolean().optional(),
  mailbox: z.string().optional(),
  inbound_domain: z.string().optional(),
  phone_number_id: z.string().optional(),
  waba_id: z.string().optional(),
  access_token: z.string().optional(),
  webhook_verify_token: z.string().optional(),
  app_secret: z.string().optional(),
  label: z.string().optional(),
  country_codes: z.string().optional(),
  is_default: z.boolean().optional(),
  account_sid: z.string().optional(),
  auth_token: z.string().optional(),
  from_number: z.string().optional(),
  messaging_service_sid: z.string().optional(),
  originator: z.string().optional(),
  secret_key: z.string().optional(),
  publishable_key: z.string().optional(),
  webhook_secret: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  mode: z.string().optional(),
  account_number: z.string().optional(),
  tracking_id: z.string().optional(),
  project_token: z.string().optional(),
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  cloud_name: z.string().optional(),
  project_id: z.string().optional(),
  instance_url: z.string().optional(),
  portal_id: z.string().optional(),
  domain: z.string().optional(),
  audience: z.string().optional(),
  api_key: z.string().optional(),
  api_secret: z.string().optional(),
  webhook_signing_secret: z.string().optional(),
  // Shipping (Shiprocket) fields
  email: z.string().optional(),
  pickup_location: z.string().optional(),
// `.passthrough()` keeps any provider field not listed above (a new provider's
// inputs flow straight through to api_config without a schema edit). buildApiConfig
// still scopes which fields are persisted per category, so this can't leak stray keys.
}).passthrough();

type CategoryPlatformFormData = z.infer<typeof categoryPlatformSchema>;

type EditSocialPlatformFormProps = {
  socialPlatform: AdminSocialPlatform;
};

const CATEGORY_LABELS: Record<string, string> = {
  email: "Email",
  communication: "Communication",
  sms: "SMS",
  payment: "Payment",
  shipping: "Shipping",
  analytics: "Analytics",
  storage: "Storage",
  crm: "CRM",
  authentication: "Authentication",
}

const EditCategoryPlatformForm = ({ socialPlatform }: EditSocialPlatformFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateSocialPlatform(socialPlatform.id);

  const apiConfig = socialPlatform.api_config as Record<string, any> | null;
  const categoryLabel = CATEGORY_LABELS[socialPlatform.category] || socialPlatform.category;

  const form = useForm<CategoryPlatformFormData>({
    resolver: zodResolver(categoryPlatformSchema),
    defaultValues: {
      name: socialPlatform.name,
      description: socialPlatform.description || "",
      status: socialPlatform.status as any,
      // Secrets default to empty (leave blank to keep existing)
      password: "",
      access_token: "",
      webhook_verify_token: "",
      app_secret: "",
      auth_token: "",
      secret_key: "",
      webhook_secret: "",
      client_secret: "",
      secret_access_key: "",
      api_secret: "",
      webhook_signing_secret: "",
      is_default: socialPlatform.api_config?.is_default === true,
      ...getFormDefaultsFromApiConfig(apiConfig),
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    // Only treat boolean fields as "user set this" if the form marked them
    // dirty. Otherwise pass `undefined` so buildApiConfig's three-way merge
    // preserves the existing DB value. Without this, a stale React Query
    // cache that loaded the form with is_default:false would silently strip
    // a DB value of true — the exact symptom of the "can't set default" bug.
    const mergedData = {
      ...data,
      is_default: form.formState.dirtyFields.is_default ? data.is_default : undefined,
    };
    // Overlay the form-derived config onto the EXISTING one so fields the form
    // doesn't render (e.g. WhatsApp templates/verified_name, cached metadata)
    // survive the wholesale api_config replace. buildApiConfig omits blank
    // values, so untouched fields keep their existing value; blank secrets are
    // restored server-side by preserveExistingSecrets. Drop UI-only `*_present`
    // hints carried over from the redacted existing config.
    const overlay = buildApiConfig(socialPlatform.category, mergedData);
    const newApiConfig: Record<string, any> = { ...(apiConfig || {}), ...overlay };
    for (const key of Object.keys(newApiConfig)) {
      if (key.endsWith("_present")) delete newApiConfig[key];
    }
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        status: data.status,
        auth_type: inferAuthType(socialPlatform.category, data.provider_type),
        api_config: newApiConfig,
      } as any,
      {
        onSuccess: ({ socialPlatform }) => {
          toast.success(`External Platform "${socialPlatform.name}" updated successfully`);
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  });

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteDrawer.Header>
          <Heading>Edit {categoryLabel} Platform</Heading>
        </RouteDrawer.Header>
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto px-6 py-4">
          <Form.Field
            control={form.control}
            name="name"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>{t("fields.name")}</Form.Label>
                <Form.Control>
                  <Input {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="description"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>{t("fields.description")}</Form.Label>
                <Form.Control>
                  <Textarea {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="status"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>{t("fields.status")}</Form.Label>
                <Form.Control>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger>
                      <Select.Value placeholder="Select status" />
                    </Select.Trigger>
                    <Select.Content>
                      {statusOptions.map((opt) => (
                        <Select.Item key={opt.value} value={opt.value}>
                          {opt.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <CategoryProviderFields
            category={socialPlatform.category}
            control={form.control}
            watch={form.watch}
            isEditing
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  );
};

export const EditSocialPlatformForm = ({ socialPlatform }: EditSocialPlatformFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateSocialPlatform(socialPlatform.id);

  // Use category-specific form for platforms with provider fields
  if (hasProviderFields(socialPlatform.category)) {
    return <EditCategoryPlatformForm socialPlatform={socialPlatform} />;
  }

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
