import { Input, Select, Switch, Text } from "@medusajs/ui"
import { Controller, type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type EmailProviderFieldValues = {
  provider_type: "imap" | "resend"
  host?: string
  port?: number
  username?: string
  password?: string
  tls?: boolean
  mailbox?: string
  api_key?: string
  webhook_signing_secret?: string
  inbound_domain?: string
}

type EmailProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const EmailProviderFields = ({
  control,
  watch,
  isEditing,
}: EmailProviderFieldsProps) => {
  const providerType = watch("provider_type")

  return (
    <>
      <Form.Field
        control={control}
        name="provider_type"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Provider Type</Form.Label>
            <Form.Control>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isEditing}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select provider type" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="imap">IMAP</Select.Item>
                  <Select.Item value="resend">Resend</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "imap" && (
        <>
          <Form.Field
            control={control}
            name="host"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>IMAP Host</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="imap.mail.me.com" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <Form.Field
              control={control}
              name="port"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Port</Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      type="number"
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      placeholder="993"
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={control}
              name="mailbox"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Mailbox</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="INBOX" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>

          <Form.Field
            control={control}
            name="username"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Username</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="user@example.com" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="password"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Password
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
                    placeholder="App-specific password"
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Controller
            control={control}
            name="tls"
            render={({ field }) => (
              <div className="flex items-center gap-x-2">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <Text size="small">Use TLS</Text>
              </div>
            )}
          />
        </>
      )}

      {providerType === "resend" && (
        <>
          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Resend API Key
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="re_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="webhook_signing_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Webhook Signing Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="whsec_..." />
                </Form.Control>
                <Form.Hint>
                  Found in your Resend dashboard under Webhooks
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="inbound_domain"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Inbound Domain</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="inbound.yourdomain.com" />
                </Form.Control>
                <Form.Hint>
                  The domain configured in Resend for receiving emails
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}
    </>
  )
}
