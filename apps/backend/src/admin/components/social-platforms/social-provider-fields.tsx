import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type SocialProviderFieldValues = {
  provider_type: "facebook" | "instagram" | "linkedin" | "twitter" | "x" | "pinterest"
  client_id?: string
  client_secret?: string
  redirect_uri?: string
  scope?: string
}

type SocialProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

const PINTEREST_DEFAULT_SCOPE =
  "boards:read boards:read_secret pins:read pins:read_secret user_accounts:read"

export const SocialProviderFields = ({
  control,
  watch,
  isEditing,
}: SocialProviderFieldsProps) => {
  const providerType = watch("provider_type")

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
                  <Select.Item value="facebook">Facebook</Select.Item>
                  <Select.Item value="instagram">Instagram</Select.Item>
                  <Select.Item value="linkedin">LinkedIn</Select.Item>
                  <Select.Item value="twitter">Twitter / X</Select.Item>
                  <Select.Item value="pinterest">Pinterest</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="client_id"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Client ID</Form.Label>
            <Form.Control>
              <Input {...field} placeholder="OAuth app id" />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="client_secret"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>
              Client Secret
              {isEditing && (
                <span className="text-ui-fg-subtle ml-1">
                  (leave blank to keep existing)
                </span>
              )}
            </Form.Label>
            <Form.Control>
              <Input {...field} type="password" placeholder="OAuth app secret" />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="redirect_uri"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Redirect URI</Form.Label>
            <Form.Control>
              <Input
                {...field}
                placeholder="https://your-domain/app/settings/oauth/pinterest/callback"
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="scope"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Scope</Form.Label>
            <Form.Control>
              <Input
                {...field}
                placeholder={
                  providerType === "pinterest" ? PINTEREST_DEFAULT_SCOPE : "space-separated scopes"
                }
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
    </>
  )
}