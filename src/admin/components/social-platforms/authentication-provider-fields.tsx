import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type AuthenticationProviderFieldValues = {
  provider_type: "auth0" | "clerk" | "firebase"
  domain?: string
  client_id?: string
  client_secret?: string
  audience?: string
  secret_key?: string
  publishable_key?: string
  project_id?: string
}

type AuthenticationProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const AuthenticationProviderFields = ({
  control,
  watch,
  isEditing,
}: AuthenticationProviderFieldsProps) => {
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
                  <Select.Item value="auth0">Auth0</Select.Item>
                  <Select.Item value="clerk">Clerk</Select.Item>
                  <Select.Item value="firebase">Firebase Auth</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {providerType === "auth0" && (
        <>
          <Form.Field
            control={control}
            name="domain"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Domain</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="your-tenant.auth0.com" />
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
                  <Input {...field} placeholder="Auth0 Application Client ID" />
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
                  <Input {...field} type="password" placeholder="Auth0 Client Secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="audience"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>API Audience</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="https://your-api.example.com" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "clerk" && (
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
                <Form.Label>Publishable Key</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="pk_..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "firebase" && (
        <>
          <Form.Field
            control={control}
            name="project_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Project ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="my-firebase-project" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Web API Key</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Firebase Web API key" />
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
                  Service Account Key (JSON)
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Paste JSON key" />
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
