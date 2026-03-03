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
import { EmailProviderFields } from "../social-platforms/email-provider-fields";

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

// Email-specific edit schema with conditional validation
const emailPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
  provider_type: z.enum(["imap", "resend"]),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  tls: z.boolean().optional(),
  mailbox: z.string().optional(),
  api_key: z.string().optional(),
  webhook_signing_secret: z.string().optional(),
  inbound_domain: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.provider_type === "imap") {
    if (!data.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Host is required" })
    if (!data.username) ctx.addIssue({ code: "custom", path: ["username"], message: "Username is required" })
    // Password not required on edit (leave blank to keep existing)
  }
  if (data.provider_type === "resend") {
    // API key and secret not required on edit (leave blank to keep existing)
  }
});

type EmailPlatformFormData = z.infer<typeof emailPlatformSchema>;

type EditSocialPlatformFormProps = {
  socialPlatform: AdminSocialPlatform;
};

const EditEmailPlatformForm = ({ socialPlatform }: EditSocialPlatformFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateSocialPlatform(socialPlatform.id);

  const apiConfig = socialPlatform.api_config as Record<string, any> | null;
  const providerType = (apiConfig?.provider as "imap" | "resend") || "imap";

  const form = useForm<EmailPlatformFormData>({
    resolver: zodResolver(emailPlatformSchema),
    defaultValues: {
      name: socialPlatform.name,
      description: socialPlatform.description || "",
      status: socialPlatform.status as any,
      provider_type: providerType,
      host: apiConfig?.host || "",
      port: apiConfig?.port || 993,
      username: apiConfig?.user || apiConfig?.username || "",
      password: "",
      tls: apiConfig?.tls !== false,
      mailbox: apiConfig?.mailbox || "INBOX",
      api_key: "",
      webhook_signing_secret: "",
      inbound_domain: apiConfig?.inbound_domain || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const newApiConfig: Record<string, any> = {
      provider: data.provider_type,
    };

    if (data.provider_type === "imap") {
      newApiConfig.host = data.host;
      newApiConfig.port = data.port || 993;
      newApiConfig.user = data.username;
      if (data.password) newApiConfig.password = data.password;
      else if (apiConfig?.password) newApiConfig.password = apiConfig.password;
      newApiConfig.tls = data.tls !== false;
      newApiConfig.mailbox = data.mailbox || "INBOX";
    } else {
      if (data.api_key) newApiConfig.api_key = data.api_key;
      else if (apiConfig?.api_key) newApiConfig.api_key = apiConfig.api_key;
      if (data.webhook_signing_secret) newApiConfig.webhook_signing_secret = data.webhook_signing_secret;
      else if (apiConfig?.webhook_signing_secret) newApiConfig.webhook_signing_secret = apiConfig.webhook_signing_secret;
      newApiConfig.inbound_domain = data.inbound_domain;
    }

    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        status: data.status,
        auth_type: data.provider_type === "resend" ? "api_key" : "basic",
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
          <Heading>Edit Email Platform</Heading>
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

          <EmailProviderFields
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

  // Use manual email form for email platforms
  if (socialPlatform.category === "email") {
    return <EditEmailPlatformForm socialPlatform={socialPlatform} />;
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
