import { zodResolver } from "@hookform/resolvers/zod"
import { Trash, PencilSquare, Plus } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  InlineTip,
  Select,
  Switch,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Form } from "../../../components/common/form"
import { SingleColumnPage } from "../../../components/layout/pages"
import { sdk } from "../../../lib/client"
import {
  usePaymentConfigs,
  useCreatePaymentConfig,
  useDeletePaymentConfig,
  type CreatePaymentConfigPayload,
} from "../../../hooks/api/payment-config"

type PaymentProvider = {
  id: string
  is_enabled: boolean
}

const PROVIDER_INFO: Record<
  string,
  { name: string; description: string; region: string }
> = {
  pp_payu_payu: {
    name: "PayU",
    description:
      "Accept payments via PayU — UPI, cards, net banking, wallets",
    region: "India",
  },
  pp_stripe_stripe: {
    name: "Stripe",
    description:
      "Accept international payments — cards, Apple Pay, Google Pay",
    region: "International",
  },
  pp_system_default: {
    name: "System Default",
    description: "Manual / cash on delivery payments",
    region: "All",
  },
}

const usePaymentProviders = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["partner-payment-providers"],
    queryFn: () =>
      sdk.client.fetch<{ payment_providers: PaymentProvider[] }>(
        "/partners/payment-providers",
        { method: "GET" }
      ),
  })
  return { providers: data?.payment_providers || [], ...rest }
}

// ── Schemas ───────────────────────────────────────────

const PayUSchema = z.object({
  provider_id: z.literal("pp_payu_payu"),
  merchant_key: z.string().min(1, "Merchant key is required"),
  merchant_salt: z.string().min(1, "Merchant salt is required"),
  mode: z.enum(["test", "live"]),
})

const StripeSchema = z.object({
  provider_id: z.literal("pp_stripe_stripe"),
  api_key: z.string().min(1, "API key is required"),
})

// ── Add Config Form ──────────────────────────────────

const AddConfigForm = ({ onClose }: { onClose: () => void }) => {
  const [selectedProvider, setSelectedProvider] = useState<string>("")
  const { mutateAsync: createConfig, isPending } = useCreatePaymentConfig()

  const payuForm = useForm<z.infer<typeof PayUSchema>>({
    resolver: zodResolver(PayUSchema),
    defaultValues: {
      provider_id: "pp_payu_payu",
      merchant_key: "",
      merchant_salt: "",
      mode: "test",
    },
  })

  const stripeForm = useForm<z.infer<typeof StripeSchema>>({
    resolver: zodResolver(StripeSchema),
    defaultValues: {
      provider_id: "pp_stripe_stripe",
      api_key: "",
    },
  })

  const handleSubmit = async () => {
    let payload: CreatePaymentConfigPayload

    if (selectedProvider === "pp_payu_payu") {
      const valid = await payuForm.trigger()
      if (!valid) return
      const values = payuForm.getValues()
      payload = {
        provider_id: "pp_payu_payu",
        credentials: {
          merchant_key: values.merchant_key,
          merchant_salt: values.merchant_salt,
          mode: values.mode,
        },
        is_active: true,
      }
    } else if (selectedProvider === "pp_stripe_stripe") {
      const valid = await stripeForm.trigger()
      if (!valid) return
      const values = stripeForm.getValues()
      payload = {
        provider_id: "pp_stripe_stripe",
        credentials: {
          api_key: values.api_key,
        },
        is_active: true,
      }
    } else {
      return
    }

    await createConfig(payload, {
      onSuccess: () => {
        toast.success("Payment credentials saved")
        onClose()
      },
      onError: (e) => {
        toast.error(e.message || "Failed to save credentials")
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-y-2">
        <Text size="small" weight="plus">
          Provider
        </Text>
        <Select value={selectedProvider} onValueChange={setSelectedProvider}>
          <Select.Trigger>
            <Select.Value placeholder="Select a provider" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="pp_payu_payu">PayU</Select.Item>
            <Select.Item value="pp_stripe_stripe">Stripe</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {selectedProvider === "pp_payu_payu" && (
        <div className="space-y-3">
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" weight="plus">
              Merchant Key
            </Text>
            <Input
              size="small"
              placeholder="Your PayU merchant key"
              {...payuForm.register("merchant_key")}
            />
            {payuForm.formState.errors.merchant_key && (
              <Text size="xsmall" className="text-ui-fg-error">
                {payuForm.formState.errors.merchant_key.message}
              </Text>
            )}
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" weight="plus">
              Merchant Salt
            </Text>
            <Input
              size="small"
              type="password"
              placeholder="Your PayU merchant salt"
              {...payuForm.register("merchant_salt")}
            />
            {payuForm.formState.errors.merchant_salt && (
              <Text size="xsmall" className="text-ui-fg-error">
                {payuForm.formState.errors.merchant_salt.message}
              </Text>
            )}
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" weight="plus">
              Mode
            </Text>
            <Select
              value={payuForm.watch("mode")}
              onValueChange={(v) =>
                payuForm.setValue("mode", v as "test" | "live")
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="test">Test</Select.Item>
                <Select.Item value="live">Live</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>
      )}

      {selectedProvider === "pp_stripe_stripe" && (
        <div className="space-y-3">
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" weight="plus">
              Stripe API Key
            </Text>
            <Input
              size="small"
              type="password"
              placeholder="sk_live_... or sk_test_..."
              {...stripeForm.register("api_key")}
            />
            {stripeForm.formState.errors.api_key && (
              <Text size="xsmall" className="text-ui-fg-error">
                {stripeForm.formState.errors.api_key.message}
              </Text>
            )}
          </div>
        </div>
      )}

      {selectedProvider && (
        <div className="flex items-center justify-end gap-x-2 pt-2">
          <Button size="small" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            onClick={handleSubmit}
            isLoading={isPending}
            disabled={!selectedProvider}
          >
            Save Credentials
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────

export const PaymentProvidersPage = () => {
  const { providers, isPending: providersLoading } = usePaymentProviders()
  const { payment_configs, isPending: configsLoading } = usePaymentConfigs()
  const { mutateAsync: deleteConfig } = useDeletePaymentConfig()
  const prompt = usePrompt()
  const [showAddForm, setShowAddForm] = useState(false)

  const handleDelete = async (configId: string, providerName: string) => {
    const confirmed = await prompt({
      title: "Remove Credentials",
      description: `Remove your custom ${providerName} credentials? Your store will fall back to the platform's shared credentials.`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    await deleteConfig(configId, {
      onSuccess: () => toast.success("Credentials removed"),
      onError: (e) => toast.error(e.message || "Failed to remove"),
    })
  }

  const isLoading = providersLoading || configsLoading

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      {/* System-wide available providers (read-only) */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Payment Providers</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            System-wide providers available to your store. Link them to your
            regions from the{" "}
            <a
              href="/settings/regions"
              className="text-ui-fg-interactive hover:underline"
            >
              Regions
            </a>{" "}
            settings.
          </Text>
        </div>

        <div className="divide-y">
          {isLoading ? (
            <div className="px-6 py-8 text-center">
              <Text className="text-ui-fg-subtle">Loading...</Text>
            </div>
          ) : providers.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Text className="text-ui-fg-subtle">
                No payment providers available.
              </Text>
            </div>
          ) : (
            providers.map((provider) => {
              const info = PROVIDER_INFO[provider.id] || {
                name: provider.id,
                description: "Payment provider",
                region: "—",
              }
              const hasCustomConfig = payment_configs.some(
                (c) => c.provider_id === provider.id
              )

              return (
                <div
                  key={provider.id}
                  className="text-ui-fg-subtle grid grid-cols-[1fr,auto] items-center px-6 py-4"
                >
                  <div>
                    <div className="flex items-center gap-x-2">
                      <Text weight="plus" className="text-ui-fg-base">
                        {info.name}
                      </Text>
                      <Badge
                        size="2xsmall"
                        color={provider.is_enabled ? "green" : "grey"}
                      >
                        {provider.is_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge size="2xsmall" color="blue">
                        {info.region}
                      </Badge>
                      {hasCustomConfig && (
                        <Badge size="2xsmall" color="purple">
                          Custom Credentials
                        </Badge>
                      )}
                    </div>
                    <Text size="small" className="text-ui-fg-subtle mt-0.5">
                      {info.description}
                    </Text>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Container>

      {/* Partner payment credentials */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Your Payment Credentials</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Add your own payment provider credentials to use your own merchant
              accounts instead of the platform defaults.
            </Text>
          </div>
          {!showAddForm && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="mr-1" />
              Add Credentials
            </Button>
          )}
        </div>

        {showAddForm && (
          <div className="px-6 py-4">
            <AddConfigForm onClose={() => setShowAddForm(false)} />
          </div>
        )}

        {payment_configs.length === 0 && !showAddForm ? (
          <div className="px-6 py-6">
            <InlineTip variant="info" label="No custom credentials">
              You are using the platform's shared payment credentials. Add your
              own credentials above to use your own merchant accounts.
            </InlineTip>
          </div>
        ) : (
          <div className="divide-y">
            {payment_configs.map((config) => {
              const info = PROVIDER_INFO[config.provider_id] || {
                name: config.provider_id,
              }

              return (
                <div
                  key={config.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div>
                    <div className="flex items-center gap-x-2">
                      <Text weight="plus">{info.name}</Text>
                      <Badge
                        size="2xsmall"
                        color={config.is_active ? "green" : "grey"}
                      >
                        {config.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-x-3 mt-1">
                      {Object.entries(config.credentials || {}).map(
                        ([key, value]) => (
                          <Text
                            key={key}
                            size="xsmall"
                            className="text-ui-fg-subtle font-mono"
                          >
                            {key}: {String(value)}
                          </Text>
                        )
                      )}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => handleDelete(config.id, info.name)}
                  >
                    <Trash />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Container>
    </SingleColumnPage>
  )
}
