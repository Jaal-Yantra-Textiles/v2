import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type ShippingProviderFieldValues = {
  provider_type: "delhivery" | "dhl" | "fedex" | "ups" | "australia_post"
  api_key?: string
  account_number?: string
  api_secret?: string
  base_url?: string
  mode?: "live" | "test"
}

type ShippingProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const ShippingProviderFields = ({
  control,
  watch,
  isEditing,
}: ShippingProviderFieldsProps) => {
  const providerType = watch("provider_type")

  const placeholders: Record<string, { apiKey: string; account: string }> = {
    delhivery: { apiKey: "Delhivery API token", account: "Client warehouse name" },
    dhl: { apiKey: "DHL API key", account: "DHL Account Number" },
    fedex: { apiKey: "FedEx API key", account: "FedEx Account Number" },
    ups: { apiKey: "UPS Client ID", account: "UPS Account Number" },
    australia_post: { apiKey: "Australia Post API key", account: "Account Number" },
  }

  const current = placeholders[providerType] || placeholders.dhl

  return (
    <>
      <Form.Field
        control={control}
        name="provider_type"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Carrier</Form.Label>
            <Form.Control>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isEditing}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select carrier" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="delhivery">Delhivery</Select.Item>
                  <Select.Item value="dhl">DHL</Select.Item>
                  <Select.Item value="fedex">FedEx</Select.Item>
                  <Select.Item value="ups">UPS</Select.Item>
                  <Select.Item value="australia_post">Australia Post</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={control}
        name="mode"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Mode</Form.Label>
            <Form.Control>
              <Select value={field.value || "test"} onValueChange={field.onChange}>
                <Select.Trigger>
                  <Select.Value placeholder="Select mode" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="test">Test / Sandbox</Select.Item>
                  <Select.Item value="live">Live</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType && (
        <>
          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  API Key
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder={current.apiKey} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          {(providerType === "fedex" || providerType === "ups") && (
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
                    <Input {...field} type="password" placeholder="API secret / Client secret" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          )}

          <Form.Field
            control={control}
            name="account_number"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Account Number</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder={current.account} />
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
