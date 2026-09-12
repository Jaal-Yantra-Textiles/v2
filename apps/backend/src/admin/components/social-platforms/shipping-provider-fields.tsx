import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type ShippingProviderFieldValues = {
  provider_type: "delhivery" | "shiprocket" | "dhl" | "fedex" | "ups" | "australia_post" | "shipglobal" | "packlink"
  api_key?: string
  account_number?: string
  api_secret?: string
  base_url?: string
  mode?: "live" | "test"
  // Shiprocket (email/password JWT auth + registered pickup-location name)
  email?: string
  password?: string
  pickup_location?: string
  // ShipGlobal (username/password Basic auth + region-specific service code)
  username?: string
  service?: string
  // Packlink (api_key + the PARTNER's OWN pickup origin — their account ships
  // from their address, not the platform's)
  origin_country?: string
  origin_zip?: string
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
    shiprocket: { apiKey: "n/a", account: "Pickup location name" },
    dhl: { apiKey: "DHL API key", account: "DHL Account Number" },
    fedex: { apiKey: "FedEx API key", account: "FedEx Account Number" },
    ups: { apiKey: "UPS Client ID", account: "UPS Account Number" },
    australia_post: { apiKey: "Australia Post API key", account: "Account Number" },
    shipglobal: { apiKey: "n/a", account: "Service code (sgdirecteuyun / sgdirectyungb)" },
    packlink: { apiKey: "Packlink PRO API key", account: "n/a" },
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
                  <Select.Item value="shiprocket">Shiprocket</Select.Item>
                  <Select.Item value="dhl">DHL</Select.Item>
                  <Select.Item value="fedex">FedEx</Select.Item>
                  <Select.Item value="ups">UPS</Select.Item>
                  <Select.Item value="australia_post">Australia Post</Select.Item>
                  <Select.Item value="shipglobal">ShipGlobal</Select.Item>
                  <Select.Item value="packlink">Packlink (EU origin)</Select.Item>
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

      {providerType === "shiprocket" && (
        <>
          <Form.Field
            control={control}
            name="email"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Account Email</Form.Label>
                <Form.Control>
                  <Input {...field} type="email" placeholder="Shiprocket account email" />
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
                  <Input {...field} type="password" placeholder="Shiprocket password" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="pickup_location"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Default Pickup Location</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder={current.account} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "shipglobal" && (
        <>
          <Form.Field
            control={control}
            name="username"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Account Email / Username</Form.Label>
                <Form.Control>
                  <Input {...field} type="email" placeholder="ShipGlobal account email" />
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
                  <Input {...field} type="password" placeholder="ShipGlobal password" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="service"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Service Code</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder={current.account} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "packlink" && (
        <>
          {/*
            The ORIGIN travels with the credential.

            Packlink quotes a lane, so it needs a from-address — and a partner's
            own Packlink account ships from THEIR warehouse, not the platform's.
            Holding it here (rather than in env) is what lets each partner run
            their own account.

            🔑 The postcode matters more than it looks: Packlink answers a bad
            one with {"messages":[{"message":"Bad Request"}]}, the same body it
            returns for an unserved lane. The provider normalises known cases
            (GB needs its space, AE rejects an all-zero placeholder) but the
            origin is the one it cannot guess.
          */}
          <Form.Field
            control={control}
            name="origin_country"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Origin country</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="IT" maxLength={2} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={control}
            name="origin_zip"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Origin postcode</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="50022" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType && providerType !== "shiprocket" && providerType !== "shipglobal" && (
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
