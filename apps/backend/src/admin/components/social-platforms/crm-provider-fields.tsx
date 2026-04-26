import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type CrmProviderFieldValues = {
  provider_type: "salesforce" | "hubspot" | "zoho"
  api_key?: string
  client_id?: string
  client_secret?: string
  instance_url?: string
  portal_id?: string
}

type CrmProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const CrmProviderFields = ({
  control,
  watch,
  isEditing,
}: CrmProviderFieldsProps) => {
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
                  <Select.Item value="salesforce">Salesforce</Select.Item>
                  <Select.Item value="hubspot">HubSpot</Select.Item>
                  <Select.Item value="zoho">Zoho CRM</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "salesforce" && (
        <>
          <Form.Field
            control={control}
            name="instance_url"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Instance URL</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="https://yourorg.my.salesforce.com" />
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
                  <Input {...field} placeholder="Connected App Consumer Key" />
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
                  <Input {...field} type="password" placeholder="Connected App Consumer Secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "hubspot" && (
        <>
          <Form.Field
            control={control}
            name="api_key"
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
                  <Input {...field} type="password" placeholder="pat-..." />
                </Form.Control>
                <Form.Hint>
                  Private app access token from HubSpot developer settings
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="portal_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Portal ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="HubSpot Account ID" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "zoho" && (
        <>
          <Form.Field
            control={control}
            name="instance_url"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>API Domain</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="https://www.zohoapis.com" />
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
                  <Input {...field} placeholder="Zoho Client ID" />
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
                  <Input {...field} type="password" placeholder="Zoho Client Secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}
    </>
  )
}
