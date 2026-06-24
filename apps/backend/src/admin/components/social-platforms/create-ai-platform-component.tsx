import { Alert, Button, Heading, Input, Select, Switch, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useCreateSocialPlatform } from "../../hooks/api/social-platforms"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { Form } from "../common/form"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { useRouteModal } from "../modal/use-route-modal"
import { getCloudflareModelWarning } from "./cloudflare-model-warning"
import { buildApiConfig } from "./api-config"
import {
  KNOWN_AI_ROLES,
  KNOWN_ROLE_VALUES,
  CUSTOM_ROLE_SENTINEL,
  ROLE_SLUG_REGEX,
  resolveRoleValue,
} from "./ai-roles"

/**
 * Tailored "Create AI provider" form.
 *
 * Sits alongside the generic CreateSocialPlatformComponent. We split it
 * out because the AI shape is small and well-defined (api_key + a few
 * provider-specific fields), and embedding it as another category branch
 * inside the already-500-line create-social-platform form would bloat
 * the validation logic for everyone.
 *
 * What this writes:
 *   - category = "ai"
 *   - auth_type = "bearer"
 *   - metadata.provider_type ∈ {openrouter, dashscope, cloudflare, vercel_ai_gateway, custom}
 *   - metadata.role ∈ KNOWN_AI_ROLES (see ai-roles.ts) OR any custom slug
 *   - metadata.is_default = true/false
 *   - api_config.api_key (plaintext on the wire — the
 *     social-platform-credentials-encryption subscriber encrypts in
 *     place after the create event fires)
 *   - api_config.default_model
 *   - api_config.account_id    (cloudflare only)
 *   - api_config.base_url      (vercel_ai_gateway + custom)
 *   - base_url (column)        (vercel_ai_gateway + custom, mirrored for searchability)
 *
 * Consumed by mastra/services/ai-platforms.ts:getAiPlatformForRole.
 */
const ProviderTypeEnum = z.enum([
  "openrouter",
  "dashscope",
  "cloudflare",
  "vercel_ai_gateway",
  "fal",
  "custom",
])

const Schema = z.object({
  name: z.string().min(1, "Name is required"),
  provider_type: ProviderTypeEnum,
  // `role` holds either a known role value or the CUSTOM_ROLE_SENTINEL; when
  // the sentinel is selected, `custom_role` carries the free-form slug. The
  // resolver (mastra/services/ai-platforms.ts) is string-tolerant, so any slug
  // works — we only enforce a sane shape here.
  role: z.string().min(1, "Role is required"),
  custom_role: z.string().optional().default(""),
  is_default: z.boolean().optional().default(true),
  api_key: z.string().min(1, "API key is required"),
  default_model: z.string().optional(),
  account_id: z.string().optional(),
  base_url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
}).superRefine((data, ctx) => {
  if (data.role === CUSTOM_ROLE_SENTINEL) {
    if (!ROLE_SLUG_REGEX.test((data.custom_role ?? "").trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_role"],
        message:
          "Use a lowercase slug like ai_marketing_vp (letters, digits, underscores)",
      })
    }
  } else if (!KNOWN_ROLE_VALUES.includes(data.role)) {
    ctx.addIssue({
      code: "custom",
      path: ["role"],
      message: "Select a role or choose Custom role…",
    })
  }
  if (data.provider_type === "cloudflare" && !data.account_id) {
    ctx.addIssue({
      code: "custom",
      path: ["account_id"],
      message: "Account ID is required for Cloudflare AI",
    })
  }
  if (
    (data.provider_type === "vercel_ai_gateway" ||
      data.provider_type === "custom") &&
    !data.base_url
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["base_url"],
      message: "Base URL is required for this provider type",
    })
  }
})

type FormValues = z.infer<typeof Schema>

const PROVIDER_LABELS: Record<z.infer<typeof ProviderTypeEnum>, string> = {
  openrouter: "OpenRouter",
  dashscope: "DashScope (Qwen)",
  cloudflare: "Cloudflare Workers AI",
  vercel_ai_gateway: "Vercel AI Gateway",
  fal: "FAL (image gen)",
  custom: "Custom (OpenAI-compatible)",
}

const DEFAULT_MODEL_HINTS: Record<z.infer<typeof ProviderTypeEnum>, string> = {
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  dashscope: "qwen-turbo  (chat) / text-embedding-v3 (embed)",
  cloudflare: "@cf/meta/llama-3.1-8b-instruct (chat) / @cf/baai/bge-base-en-v1.5 (embed)",
  vercel_ai_gateway: "openai/gpt-4o-mini",
  fal: "fal-ai/flux/schnell — optional; FAL endpoint is chosen per-call",
  custom: "your-model-id",
}

export const CreateAiPlatformComponent = () => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreateSocialPlatform()

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema as any),
    defaultValues: {
      name: "",
      provider_type: "openrouter" as const,
      role: "ai_search_chat",
      custom_role: "",
      is_default: true,
      api_key: "",
      default_model: "",
      account_id: "",
      base_url: "",
    },
  })

  const providerType = form.watch("provider_type")
  const roleSelection = form.watch("role")
  const defaultModel = form.watch("default_model")
  const cloudflareModelWarning = getCloudflareModelWarning(
    providerType,
    defaultModel
  )

  const onSubmit = form.handleSubmit(async (values) => {
    // Single source of truth for the AI api_config shape (#427) — the edit
    // form builds the same blob via buildApiConfig("ai", …).
    const apiConfig = buildApiConfig("ai", values)

    try {
      await mutateAsync({
        name: values.name,
        category: "ai",
        auth_type: "bearer",
        status: "active",
        base_url:
          values.base_url && values.base_url.length > 0
            ? values.base_url
            : undefined,
        api_config: apiConfig,
        metadata: {
          provider_type: values.provider_type,
          role: resolveRoleValue(values),
          is_default: values.is_default ?? true,
          source: "admin_ui",
        },
      })
      toast.success("AI provider created")
      handleSuccess("/settings/external-platforms")
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create AI provider")
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex h-full flex-col">
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
          <div className="flex w-full max-w-[640px] flex-col gap-y-8">
            <div>
              <Heading>Create AI provider</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Configure a chat or embedding provider that storefront
                search and AI-using workflows will pick up at runtime.
                The API key is encrypted on save.
              </Text>
            </div>

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      placeholder="e.g. OpenRouter free, DashScope qwen, CF Workers AI"
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="provider_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Provider</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select provider" />
                        </Select.Trigger>
                        <Select.Content>
                          {Object.entries(PROVIDER_LABELS).map(([v, label]) => (
                            <Select.Item key={v} value={v}>
                              {label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Role</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select role" />
                        </Select.Trigger>
                        <Select.Content>
                          {KNOWN_AI_ROLES.map((r) => (
                            <Select.Item key={r.value} value={r.value}>
                              {r.label}
                            </Select.Item>
                          ))}
                          <Select.Item value={CUSTOM_ROLE_SENTINEL}>
                            Custom role…
                          </Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>

            {roleSelection === CUSTOM_ROLE_SENTINEL && (
              <Form.Field
                control={form.control}
                name="custom_role"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Custom role</Form.Label>
                    <Form.Control>
                      <Input
                        {...field}
                        placeholder="e.g. ai_marketing_vp"
                        autoComplete="off"
                      />
                    </Form.Control>
                    <Form.Hint>
                      Any new role string the resolver should match on
                      (lowercase slug). Workflows look this up verbatim via{" "}
                      <code>getAiPlatformForRole</code>.
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}

            <Form.Field
              control={form.control}
              name="api_key"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>API key</Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      type="password"
                      placeholder="sk-…"
                      autoComplete="off"
                    />
                  </Form.Control>
                  <Form.Hint>
                    Stored encrypted via the encryption subscriber on save.
                  </Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {providerType === "cloudflare" && (
              <Form.Field
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Cloudflare account ID</Form.Label>
                    <Form.Control>
                      <Input
                        {...field}
                        placeholder="e.g. 9719d38e64dffe8fd6982afb3a7b25f6"
                      />
                    </Form.Control>
                    <Form.Hint>
                      Used to construct the base URL{" "}
                      <code>api.cloudflare.com/.../{`<account_id>`}/ai/v1</code>.
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}

            {(providerType === "vercel_ai_gateway" ||
              providerType === "custom") && (
              <Form.Field
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Base URL</Form.Label>
                    <Form.Control>
                      <Input
                        {...field}
                        type="url"
                        placeholder="https://gateway.example.com/v1"
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}

            <Form.Field
              control={form.control}
              name="default_model"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Default model</Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      placeholder={DEFAULT_MODEL_HINTS[providerType]}
                    />
                  </Form.Control>
                  <Form.Hint>
                    Optional. If empty, a provider-specific default is used.
                  </Form.Hint>
                  {cloudflareModelWarning && (
                    <Alert
                      variant="warning"
                      className="mt-2"
                      data-testid="cloudflare-model-warning"
                    >
                      {cloudflareModelWarning}
                    </Alert>
                  )}
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="is_default"
              render={({ field }) => (
                <Form.Item>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <Form.Label>Default for this role</Form.Label>
                      <Text size="small" className="text-ui-fg-subtle">
                        Only one platform per role should be default. The
                        runtime picks the default; other platforms are
                        available as alternatives.
                      </Text>
                    </div>
                    <Form.Control>
                      <Switch
                        checked={field.value === true}
                        onCheckedChange={(v: boolean) => field.onChange(v)}
                      />
                    </Form.Control>
                  </div>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
