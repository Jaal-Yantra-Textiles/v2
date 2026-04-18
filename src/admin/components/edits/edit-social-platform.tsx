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
});

type CategoryPlatformFormData = z.infer<typeof categoryPlatformSchema>;

type EditSocialPlatformFormProps = {
  socialPlatform: AdminSocialPlatform;
};

/**
 * Parse comma-separated country codes into a normalized array of E.164
 * prefixes. Returns undefined for empty input so api_config doesn't carry
 * an empty array.
 */
function parseCountryCodes(input: string | undefined | null): string[] | undefined {
  if (!input) return undefined
  const codes = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("+") ? s : `+${s}`))
  return codes.length ? codes : undefined
}

/** Build defaults from existing api_config */
function getDefaultsFromApiConfig(apiConfig: Record<string, any> | null): Record<string, any> {
  if (!apiConfig) return {}
  return {
    provider_type: apiConfig.provider || "",
    host: apiConfig.host || "",
    port: apiConfig.port || 993,
    username: apiConfig.user || apiConfig.username || "",
    tls: apiConfig.tls !== false,
    mailbox: apiConfig.mailbox || "INBOX",
    inbound_domain: apiConfig.inbound_domain || "",
    phone_number_id: apiConfig.phone_number_id || "",
    waba_id: apiConfig.waba_id || "",
    label: apiConfig.label || "",
    country_codes: Array.isArray(apiConfig.country_codes)
      ? apiConfig.country_codes.join(", ")
      : "",
    is_default: apiConfig.is_default === true,
    account_sid: apiConfig.account_sid || "",
    from_number: apiConfig.from_number || "",
    messaging_service_sid: apiConfig.messaging_service_sid || "",
    originator: apiConfig.originator || "",
    publishable_key: apiConfig.publishable_key || "",
    client_id: apiConfig.client_id || "",
    mode: apiConfig.mode || "test",
    account_number: apiConfig.account_number || "",
    tracking_id: apiConfig.tracking_id || "",
    project_token: apiConfig.project_token || "",
    access_key_id: apiConfig.access_key_id || "",
    bucket: apiConfig.bucket || "",
    region: apiConfig.region || "",
    endpoint: apiConfig.endpoint || "",
    cloud_name: apiConfig.cloud_name || "",
    project_id: apiConfig.project_id || "",
    instance_url: apiConfig.instance_url || "",
    portal_id: apiConfig.portal_id || "",
    domain: apiConfig.domain || "",
    audience: apiConfig.audience || "",
    api_key: apiConfig.api_key || "",
  }
}

/** Merge form data with existing api_config, keeping existing secrets when fields are left blank */
function mergeApiConfig(
  category: string,
  data: Record<string, any>,
  existingConfig: Record<string, any> | null
): Record<string, any> {
  const config: Record<string, any> = { provider: data.provider_type }
  const existing = existingConfig || {}

  // Helper: use new value if provided, otherwise keep existing
  const mergeSecret = (key: string) => data[key] || existing[key] || undefined

  switch (category) {
    case "email":
      if (data.provider_type === "imap") {
        Object.assign(config, {
          host: data.host,
          port: data.port || 993,
          user: data.username,
          password: mergeSecret("password"),
          tls: data.tls !== false,
          mailbox: data.mailbox || "INBOX",
        })
      } else {
        Object.assign(config, {
          api_key: mergeSecret("api_key"),
          webhook_signing_secret: mergeSecret("webhook_signing_secret"),
          inbound_domain: data.inbound_domain,
        })
      }
      break

    case "communication":
      Object.assign(config, {
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id || existing.waba_id || undefined,
        access_token: mergeSecret("access_token"),
        app_secret: mergeSecret("app_secret"),
        webhook_verify_token: mergeSecret("webhook_verify_token"),
        label: data.label || undefined,
        country_codes: parseCountryCodes(data.country_codes),
        is_default: data.is_default === true ? true : undefined,
        // Preserve Meta-supplied display metadata and cached templates
        // (synced separately from the WhatsApp templates section)
        display_phone_number: existing.display_phone_number,
        verified_name: existing.verified_name,
        templates: existing.templates,
        templates_synced_at: existing.templates_synced_at,
        initiation_template: existing.initiation_template,
        initiation_template_lang: existing.initiation_template_lang,
      })
      break

    case "sms":
      if (data.provider_type === "twilio") {
        Object.assign(config, {
          account_sid: data.account_sid,
          auth_token: mergeSecret("auth_token"),
          from_number: data.from_number,
          messaging_service_sid: data.messaging_service_sid,
        })
      } else {
        Object.assign(config, {
          api_key: mergeSecret("api_key"),
          originator: data.originator,
        })
      }
      break

    case "payment":
      Object.assign(config, {
        mode: data.mode || "test",
        api_key: data.api_key || existing.api_key,
        secret_key: mergeSecret("secret_key"),
        publishable_key: data.publishable_key,
        webhook_secret: mergeSecret("webhook_secret"),
        client_id: data.client_id,
        client_secret: mergeSecret("client_secret"),
      })
      break

    case "shipping":
      Object.assign(config, {
        mode: data.mode || "test",
        api_key: mergeSecret("api_key"),
        api_secret: mergeSecret("api_secret"),
        account_number: data.account_number,
      })
      break

    case "analytics":
      Object.assign(config, {
        tracking_id: data.tracking_id,
        api_key: mergeSecret("api_key"),
        api_secret: mergeSecret("api_secret"),
        project_token: data.project_token,
        host: data.host,
      })
      break

    case "storage":
      Object.assign(config, {
        access_key_id: data.access_key_id,
        secret_access_key: mergeSecret("secret_access_key"),
        bucket: data.bucket,
        region: data.region,
        endpoint: data.endpoint,
        cloud_name: data.cloud_name,
        api_key: mergeSecret("api_key"),
        api_secret: mergeSecret("api_secret"),
        project_id: data.project_id,
      })
      break

    case "crm":
      Object.assign(config, {
        api_key: mergeSecret("api_key"),
        client_id: data.client_id,
        client_secret: mergeSecret("client_secret"),
        instance_url: data.instance_url,
        portal_id: data.portal_id,
      })
      break

    case "authentication":
      Object.assign(config, {
        domain: data.domain,
        client_id: data.client_id,
        client_secret: mergeSecret("client_secret"),
        audience: data.audience,
        secret_key: mergeSecret("secret_key"),
        publishable_key: data.publishable_key,
        project_id: data.project_id,
        api_key: mergeSecret("api_key"),
      })
      break
  }

  return Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined && v !== "")
  )
}

/** Infer auth_type from category and provider */
function inferAuthType(category: string, providerType?: string): string {
  switch (category) {
    case "email": return providerType === "resend" ? "api_key" : "basic"
    case "communication": return "bearer"
    case "sms": return providerType === "twilio" ? "basic" : "api_key"
    case "payment": return "api_key"
    case "shipping": return "api_key"
    case "analytics": return "api_key"
    case "storage": return "api_key"
    case "crm": return providerType === "hubspot" ? "api_key" : "oauth2"
    case "authentication": return "oauth2"
    default: return "api_key"
  }
}

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
      ...getDefaultsFromApiConfig(apiConfig),
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const newApiConfig = mergeApiConfig(socialPlatform.category, data, apiConfig);

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
