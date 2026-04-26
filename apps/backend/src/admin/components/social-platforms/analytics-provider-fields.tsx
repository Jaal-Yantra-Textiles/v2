import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type AnalyticsProviderFieldValues = {
  provider_type: "google_analytics" | "mixpanel" | "posthog" | "segment"
  tracking_id?: string
  api_key?: string
  api_secret?: string
  project_token?: string
  host?: string
}

type AnalyticsProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const AnalyticsProviderFields = ({
  control,
  watch,
  isEditing,
}: AnalyticsProviderFieldsProps) => {
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
                  <Select.Item value="google_analytics">Google Analytics</Select.Item>
                  <Select.Item value="mixpanel">Mixpanel</Select.Item>
                  <Select.Item value="posthog">PostHog</Select.Item>
                  <Select.Item value="segment">Segment</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "google_analytics" && (
        <>
          <Form.Field
            control={control}
            name="tracking_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Measurement ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="G-XXXXXXXXXX" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  API Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Measurement Protocol API secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "mixpanel" && (
        <>
          <Form.Field
            control={control}
            name="project_token"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Project Token</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Mixpanel project token" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  API Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Mixpanel API secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "posthog" && (
        <>
          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Project API Key
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="phc_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="host"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Host</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="https://app.posthog.com (default)" />
                </Form.Control>
                <Form.Hint>
                  Self-hosted PostHog instance URL, leave blank for cloud
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "segment" && (
        <Form.Field
          control={control}
          name="api_key"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>
                Write Key
                {isEditing && (
                  <span className="text-ui-fg-subtle ml-1">
                    (leave blank to keep existing)
                  </span>
                )}
              </Form.Label>
              <Form.Control>
                <Input {...field} type="password" placeholder="Segment Write Key" />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}
    </>
  )
}
