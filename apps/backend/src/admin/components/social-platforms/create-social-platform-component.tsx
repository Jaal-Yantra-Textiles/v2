import { Button, Heading, Input, Textarea, toast, Text, Select } from "@medusajs/ui"
import { RouteFocusModal } from "../modal/route-focus-modal" // Assuming path based on task-template
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useCreateSocialPlatform } from "../../hooks/api/social-platforms" // Adjusted path

import { KeyboundForm } from "../utilitites/key-bound-form"
import { Form } from "../common/form"
import { useRouteModal } from "../modal/use-route-modal"
import { CategoryProviderFields, hasProviderFields } from "./category-provider-fields"

const CreateSocialPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  base_url: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  category: z.enum(["social", "payment", "shipping", "email", "sms", "analytics", "crm", "storage", "communication", "authentication", "other"]).optional(),
  auth_type: z.enum(["oauth2", "oauth1", "api_key", "bearer", "basic"]).optional(),
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
  // Provider type (shared across categories)
  provider_type: z.string().optional(),
  // Email fields
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  tls: z.boolean().optional(),
  mailbox: z.string().optional(),
  inbound_domain: z.string().optional(),
  // Communication (WhatsApp) fields
  phone_number_id: z.string().optional(),
  waba_id: z.string().optional(),
  access_token: z.string().optional(),
  webhook_verify_token: z.string().optional(),
  app_secret: z.string().optional(),
  // Multi-number routing (WhatsApp)
  label: z.string().optional(),
  country_codes: z.string().optional(),
  is_default: z.boolean().optional(),
  // SMS fields
  account_sid: z.string().optional(),
  auth_token: z.string().optional(),
  from_number: z.string().optional(),
  messaging_service_sid: z.string().optional(),
  originator: z.string().optional(),
  // Payment fields
  secret_key: z.string().optional(),
  publishable_key: z.string().optional(),
  webhook_secret: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  mode: z.string().optional(),
  // Shipping fields
  account_number: z.string().optional(),
  // Analytics fields
  tracking_id: z.string().optional(),
  project_token: z.string().optional(),
  // Storage fields
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  cloud_name: z.string().optional(),
  project_id: z.string().optional(),
  // CRM fields
  instance_url: z.string().optional(),
  portal_id: z.string().optional(),
  // Auth fields
  domain: z.string().optional(),
  audience: z.string().optional(),
  // Shared
  api_key: z.string().optional(),
  api_secret: z.string().optional(),
  webhook_signing_secret: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.category === "email") {
    if (!data.provider_type) {
      ctx.addIssue({ code: "custom", path: ["provider_type"], message: "Provider type is required" })
    }
    if (data.provider_type === "imap") {
      if (!data.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Host is required" })
      if (!data.username) ctx.addIssue({ code: "custom", path: ["username"], message: "Username is required" })
      if (!data.password) ctx.addIssue({ code: "custom", path: ["password"], message: "Password is required" })
    }
    if (data.provider_type === "resend") {
      if (!data.api_key) ctx.addIssue({ code: "custom", path: ["api_key"], message: "API key is required" })
      if (!data.webhook_signing_secret) ctx.addIssue({ code: "custom", path: ["webhook_signing_secret"], message: "Webhook signing secret is required" })
    }
  }
  if (data.category === "communication" && data.provider_type === "whatsapp") {
    if (!data.phone_number_id) ctx.addIssue({ code: "custom", path: ["phone_number_id"], message: "Phone Number ID is required" })
    if (!data.access_token) ctx.addIssue({ code: "custom", path: ["access_token"], message: "Access Token is required" })
  }
})

type CreateSocialPlatformForm = z.infer<typeof CreateSocialPlatformSchema>

/**
 * Parse comma-separated country codes into a normalized array of E.164
 * prefixes (e.g. "91, +61" → ["+91", "+61"]). Returns undefined for empty
 * input so api_config doesn't carry an empty array.
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

/** Build api_config from form data based on category */
function buildApiConfig(category: string, data: Record<string, any>): Record<string, any> {
  const config: Record<string, any> = { provider: data.provider_type }

  switch (category) {
    case "email":
      if (data.provider_type === "imap") {
        Object.assign(config, {
          host: data.host,
          port: data.port || 993,
          user: data.username,
          password: data.password,
          tls: data.tls !== false,
          mailbox: data.mailbox || "INBOX",
        })
      } else {
        Object.assign(config, {
          api_key: data.api_key,
          webhook_signing_secret: data.webhook_signing_secret,
          inbound_domain: data.inbound_domain,
        })
      }
      break

    case "communication":
      Object.assign(config, {
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        access_token: data.access_token,
        app_secret: data.app_secret,
        webhook_verify_token: data.webhook_verify_token,
        label: data.label,
        country_codes: parseCountryCodes(data.country_codes),
        is_default: data.is_default === true ? true : undefined,
      })
      break

    case "sms":
      if (data.provider_type === "twilio") {
        Object.assign(config, {
          account_sid: data.account_sid,
          auth_token: data.auth_token,
          from_number: data.from_number,
          messaging_service_sid: data.messaging_service_sid,
        })
      } else {
        Object.assign(config, {
          api_key: data.api_key,
          originator: data.originator,
        })
      }
      break

    case "payment":
      Object.assign(config, {
        mode: data.mode || "test",
        api_key: data.api_key,
        secret_key: data.secret_key,
        publishable_key: data.publishable_key,
        webhook_secret: data.webhook_secret,
        client_id: data.client_id,
        client_secret: data.client_secret,
      })
      break

    case "shipping":
      Object.assign(config, {
        mode: data.mode || "test",
        api_key: data.api_key,
        api_secret: data.api_secret,
        account_number: data.account_number,
      })
      break

    case "analytics":
      Object.assign(config, {
        tracking_id: data.tracking_id,
        api_key: data.api_key,
        api_secret: data.api_secret,
        project_token: data.project_token,
        host: data.host,
      })
      break

    case "storage":
      Object.assign(config, {
        access_key_id: data.access_key_id,
        secret_access_key: data.secret_access_key,
        bucket: data.bucket,
        region: data.region,
        endpoint: data.endpoint,
        cloud_name: data.cloud_name,
        api_key: data.api_key,
        api_secret: data.api_secret,
        project_id: data.project_id,
      })
      break

    case "crm":
      Object.assign(config, {
        api_key: data.api_key,
        client_id: data.client_id,
        client_secret: data.client_secret,
        instance_url: data.instance_url,
        portal_id: data.portal_id,
      })
      break

    case "authentication":
      Object.assign(config, {
        domain: data.domain,
        client_id: data.client_id,
        client_secret: data.client_secret,
        audience: data.audience,
        secret_key: data.secret_key,
        publishable_key: data.publishable_key,
        project_id: data.project_id,
        api_key: data.api_key,
      })
      break
  }

  // Remove undefined/empty values
  return Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined && v !== "")
  )
}

/** Infer auth_type from category and provider */
function inferAuthType(category: string, providerType?: string): string {
  switch (category) {
    case "email":
      return providerType === "resend" ? "api_key" : "basic"
    case "communication":
      return "bearer"
    case "sms":
      return providerType === "twilio" ? "basic" : "api_key"
    case "payment":
      return "api_key"
    case "shipping":
      return "api_key"
    case "analytics":
      return "api_key"
    case "storage":
      return "api_key"
    case "crm":
      return providerType === "hubspot" ? "api_key" : "oauth2"
    case "authentication":
      return "oauth2"
    default:
      return "api_key"
  }
}

export const CreateSocialPlatformComponent = () => {
  const { handleSuccess } = useRouteModal();
  const form = useForm<CreateSocialPlatformForm>({
    resolver: zodResolver(CreateSocialPlatformSchema),
    defaultValues: {
      name: "",
      description: "",
      base_url: "",
      category: "social",
      auth_type: "oauth2",
      status: "pending",
      provider_type: "imap",
      host: "",
      port: 993,
      username: "",
      password: "",
      tls: true,
      mailbox: "INBOX",
      api_key: "",
      webhook_signing_secret: "",
      inbound_domain: "",
    },
  })

  const { mutateAsync, isPending } = useCreateSocialPlatform()
  const selectedCategory = form.watch("category") || ""
  const hasCategoryFields = hasProviderFields(selectedCategory)

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      let payload: Record<string, any> = {
        name: data.name,
        description: data.description,
        category: data.category,
        status: data.status,
      }

      if (hasCategoryFields) {
        const apiConfig = buildApiConfig(data.category || "", data)
        payload.api_config = apiConfig
        payload.auth_type = inferAuthType(data.category || "", data.provider_type)
        payload.metadata = { provider: data.provider_type }
        payload.status = "active"
      } else {
        payload.base_url = data.base_url
        payload.auth_type = data.auth_type
      }

      await mutateAsync(payload as any, {
        onSuccess: ({ socialPlatform }) => {
          toast.success("External Platform created successfully")
          handleSuccess(`/settings/external-platforms/${socialPlatform.id}`)
        },
      })
    } catch (e: any) {
      toast.error(e.message)
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create External Platform</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Connect a new external platform (social media, analytics, CRM, etc.) to your system.
              </Text>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Name</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="e.g. WhatsApp Business, Stripe, Facebook" />
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
                    <Form.Label optional>Description</Form.Label>
                    <Form.Control>
                      <Textarea {...field} placeholder="e.g. Official Facebook page for customer engagement" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Category</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select category" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="social">Social Media</Select.Item>
                          <Select.Item value="payment">Payment</Select.Item>
                          <Select.Item value="shipping">Shipping</Select.Item>
                          <Select.Item value="email">Email</Select.Item>
                          <Select.Item value="sms">SMS</Select.Item>
                          <Select.Item value="analytics">Analytics</Select.Item>
                          <Select.Item value="crm">CRM</Select.Item>
                          <Select.Item value="storage">Storage</Select.Item>
                          <Select.Item value="communication">Communication</Select.Item>
                          <Select.Item value="authentication">Authentication</Select.Item>
                          <Select.Item value="other">Other</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {hasCategoryFields ? (
                <CategoryProviderFields
                  category={selectedCategory}
                  control={form.control}
                  watch={form.watch}
                />
              ) : (
                <>
                  <Form.Field
                    control={form.control}
                    name="base_url"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label optional>Base URL</Form.Label>
                        <Form.Control>
                          <Input type="url" {...field} placeholder="https://api.platform.com" />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="auth_type"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Authentication Type</Form.Label>
                        <Form.Control>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <Select.Trigger>
                              <Select.Value placeholder="Select authentication type" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Item value="oauth2">OAuth 2.0</Select.Item>
                              <Select.Item value="oauth1">OAuth 1.0</Select.Item>
                              <Select.Item value="api_key">API Key</Select.Item>
                              <Select.Item value="bearer">Bearer Token</Select.Item>
                              <Select.Item value="basic">Basic Auth</Select.Item>
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </>
              )}

              <Form.Field
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Status</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select status" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="pending">Pending</Select.Item>
                          <Select.Item value="active">Active</Select.Item>
                          <Select.Item value="inactive">Inactive</Select.Item>
                          <Select.Item value="error">Error</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

export default CreateSocialPlatformComponent
