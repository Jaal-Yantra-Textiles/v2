import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type SmsProviderFieldValues = {
  provider_type: "twilio" | "messagebird"
  account_sid?: string
  auth_token?: string
  from_number?: string
  messaging_service_sid?: string
  api_key?: string
  originator?: string
}

type SmsProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const SmsProviderFields = ({
  control,
  watch,
  isEditing,
}: SmsProviderFieldsProps) => {
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
                  <Select.Item value="twilio">Twilio</Select.Item>
                  <Select.Item value="messagebird">MessageBird</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "twilio" && (
        <>
          <Form.Field
            control={control}
            name="account_sid"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Account SID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="AC..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="auth_token"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Auth Token
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Twilio Auth Token" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <Form.Field
              control={control}
              name="from_number"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>From Number</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="+1234567890" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={control}
              name="messaging_service_sid"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Messaging Service SID</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="MG..." />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
        </>
      )}

      {providerType === "messagebird" && (
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
                  <Input {...field} type="password" placeholder="MessageBird API key" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="originator"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Originator</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Sender name or number" />
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
