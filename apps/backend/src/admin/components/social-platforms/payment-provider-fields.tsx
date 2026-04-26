import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type PaymentProviderFieldValues = {
  provider_type: "stripe" | "razorpay" | "paypal"
  api_key?: string
  secret_key?: string
  publishable_key?: string
  webhook_secret?: string
  client_id?: string
  client_secret?: string
  mode?: "live" | "test"
}

type PaymentProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const PaymentProviderFields = ({
  control,
  watch,
  isEditing,
}: PaymentProviderFieldsProps) => {
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
                  <Select.Item value="stripe">Stripe</Select.Item>
                  <Select.Item value="razorpay">Razorpay</Select.Item>
                  <Select.Item value="paypal">PayPal</Select.Item>
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

      {providerType === "stripe" && (
        <>
          <Form.Field
            control={control}
            name="secret_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Secret Key
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="sk_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="publishable_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Publishable Key</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="pk_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="webhook_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Webhook Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="whsec_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "razorpay" && (
        <>
          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Key ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="rzp_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="secret_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Key Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Razorpay Key Secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="webhook_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Webhook Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Webhook signing secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "paypal" && (
        <>
          <Form.Field
            control={control}
            name="client_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Client ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="PayPal Client ID" />
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
                  <Input {...field} type="password" placeholder="PayPal Client Secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="webhook_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Webhook ID
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="PayPal Webhook ID" />
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
