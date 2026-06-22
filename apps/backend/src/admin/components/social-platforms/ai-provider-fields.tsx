import { Alert, Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"
import { getCloudflareModelWarning } from "./cloudflare-model-warning"

/**
 * Shared AI-provider config fields, rendered by the generic
 * CategoryProviderFields switch (and thus the edit form). Mirrors the field set
 * of the tailored create-ai-platform-component.tsx so create + edit stay in
 * lockstep — but only the connection fields (provider_type / api_key /
 * default_model / account_id / base_url). `role` and `is_default` live in
 * `metadata` and are NOT editable after creation, so they are intentionally not
 * rendered here.
 *
 * On edit (`isEditing`) the `provider_type` is shown but DISABLED: changing it
 * would invalidate the stored config + credentials, so it must be fixed at
 * creation. Only the model / key / account_id / base_url are editable.
 */

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  dashscope: "DashScope (Qwen)",
  cloudflare: "Cloudflare Workers AI",
  vercel_ai_gateway: "Vercel AI Gateway",
  fal: "FAL (image gen)",
  custom: "Custom (OpenAI-compatible)",
}

const DEFAULT_MODEL_HINTS: Record<string, string> = {
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  dashscope: "qwen-turbo (chat) / text-embedding-v3 (embed)",
  cloudflare:
    "@cf/meta/llama-3.1-8b-instruct (chat) / @cf/baai/bge-base-en-v1.5 (embed)",
  vercel_ai_gateway: "openai/gpt-4o-mini",
  fal: "fal-ai/flux/schnell — optional; FAL endpoint is chosen per-call",
  custom: "your-model-id",
}

type AiProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const AiProviderFields = ({
  control,
  watch,
  isEditing,
}: AiProviderFieldsProps) => {
  const providerType = watch("provider_type") as string | undefined
  const defaultModel = watch("default_model") as string | undefined
  const cloudflareModelWarning = getCloudflareModelWarning(
    providerType,
    defaultModel
  )

  return (
    <>
      <Form.Field
        control={control}
        name="provider_type"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Provider</Form.Label>
            <Form.Control>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isEditing}
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
            {isEditing && (
              <Form.Hint>
                Provider can't be changed after creation — it would invalidate
                the stored credentials.
              </Form.Hint>
            )}
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="api_key"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>
              API key
              {isEditing && (
                <span className="text-ui-fg-subtle ml-1">
                  (leave blank to keep existing)
                </span>
              )}
            </Form.Label>
            <Form.Control>
              <Input
                {...field}
                type="password"
                placeholder="sk-…"
                autoComplete="off"
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "cloudflare" && (
        <Form.Field
          control={control}
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
          control={control}
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
        control={control}
        name="default_model"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Default model</Form.Label>
            <Form.Control>
              <Input
                {...field}
                placeholder={
                  (providerType && DEFAULT_MODEL_HINTS[providerType]) ||
                  "your-model-id"
                }
              />
            </Form.Control>
            <Form.Hint>
              If empty, a provider-specific default is used.
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
    </>
  )
}
