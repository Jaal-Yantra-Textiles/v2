import { Input, Select, Switch, Text } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type CommunicationProviderFieldValues = {
  provider_type: "whatsapp"
  phone_number_id?: string
  waba_id?: string
  access_token?: string
  webhook_verify_token?: string
  app_secret?: string
  label?: string
  country_codes?: string
  is_default?: boolean
}

type CommunicationProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const CommunicationProviderFields = ({
  control,
  watch,
  isEditing,
}: CommunicationProviderFieldsProps) => {
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
                  <Select.Item value="whatsapp">WhatsApp Business</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "whatsapp" && (
        <>
          <Form.Field
            control={control}
            name="phone_number_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Phone Number ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="e.g. 123456789012345" />
                </Form.Control>
                <Form.Hint>
                  Found in Meta Business Manager under WhatsApp &gt; API Setup
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="waba_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>WhatsApp Business Account ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="e.g. 1331897429001126" />
                </Form.Control>
                <Form.Hint>
                  Required for templates. Found in Meta Business Manager under
                  WhatsApp Accounts &gt; Account Info. Can be set later from
                  the platform detail page.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="access_token"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Access Token
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="System User permanent token" />
                </Form.Control>
                <Form.Hint>
                  Use a System User token from Meta Business Settings for permanent access
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="app_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  App Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Meta App Secret" />
                </Form.Control>
                <Form.Hint>
                  Used to verify webhook signatures from Meta
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="webhook_verify_token"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Webhook Verify Token
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Your custom verification token" />
                </Form.Control>
                <Form.Hint>
                  A secret string you define — must match the token set in Meta webhook config
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="mt-6">
            <Text size="small" weight="plus" className="text-ui-fg-subtle">
              Routing (optional)
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              Add multiple WhatsApp numbers and pick which one sends replies to
              each conversation. Shown in the conversation header as "Sending
              as".
            </Text>
          </div>

          <Form.Field
            control={control}
            name="label"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Label</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="e.g. India, Australia, Support" />
                </Form.Control>
                <Form.Hint>
                  Human-readable name shown in the admin sender picker
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="country_codes"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Country codes</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="+91, +61" />
                </Form.Control>
                <Form.Hint>
                  Comma-separated E.164 prefixes this number services. Used to
                  auto-route outbound messages (longest match wins). Leave
                  blank to use this number only via manual selection or as the
                  default.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          {/*
            Canonical Medusa SwitchBox pattern
            (@medusajs/dashboard/src/components/common/switch-box/switch-box.tsx:33).
            Three things make it work where ad-hoc wiring didn't:
              1. Destructure `{ value, onChange, ...field }` — the remaining
                 `field` object carries `ref`/`name`/`onBlur`.
              2. Spread `{...field}` onto the Switch BEFORE `checked` /
                 `onCheckedChange`. The ref forward is what links the Radix
                 widget's internal state back to Controller.
              3. `Form.Control` directly wraps the Switch (no div). Slot's
                 prop-cloning is fine when the ref chain is intact.
          */}
          <Form.Field
            control={control}
            name="is_default"
            render={({ field: { value, onChange, ...field } }) => (
              <Form.Item>
                <div className="bg-ui-bg-component shadow-elevation-card-rest flex items-start gap-x-3 rounded-lg p-3">
                  <Form.Control>
                    <Switch
                      {...field}
                      checked={value}
                      onCheckedChange={(checked) => onChange(checked)}
                    />
                  </Form.Control>
                  <div>
                    <Form.Label>Use as default sender</Form.Label>
                    <Form.Hint>
                      Fallback when no country code matches. At most one
                      number can be default — setting this unpins any other
                      default.
                    </Form.Hint>
                  </div>
                </div>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}
    </>
  )
}
