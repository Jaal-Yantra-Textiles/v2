import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  Switch,
  Label,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { SingleColumnPage } from "../../../components/layout/pages"
import { GeneralSectionSkeleton } from "../../../components/common/skeleton"
import { sdk } from "../../../lib/client"
import { usePartnerStores } from "../../../hooks/api/partner-stores"

type PaymentProvider = {
  id: string
  is_enabled: boolean
}

type RegionPaymentProvider = {
  id?: string
  payment_provider_id?: string
  payment_provider?: PaymentProvider
}

const PROVIDER_INFO: Record<string, { name: string; description: string; region: string }> = {
  "pp_payu_payu": {
    name: "PayU",
    description: "Accept payments via PayU — popular in India (UPI, cards, net banking, wallets)",
    region: "India",
  },
  "pp_stripe_stripe": {
    name: "Stripe",
    description: "Accept international payments via Stripe (cards, Apple Pay, Google Pay)",
    region: "International",
  },
  "pp_system_default": {
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

const useRegionPaymentProviders = (regionId: string | undefined) => {
  const { data, ...rest } = useQuery({
    queryKey: ["region-payment-providers", regionId],
    queryFn: async () => {
      if (!regionId) return { region: null }
      const resp = await sdk.client.fetch<{ region: any }>(
        `/partners/stores/${regionId}/region-providers`,
        { method: "GET" }
      )
      return resp
    },
    enabled: !!regionId,
  })
  return { region: data?.region, ...rest }
}

export const PaymentProvidersPage = () => {
  const { stores, isPending: storesLoading } = usePartnerStores()
  const store = stores?.[0]
  const { providers, isPending: providersLoading } = usePaymentProviders()

  if (storesLoading || providersLoading) {
    return (
      <SingleColumnPage>
        <GeneralSectionSkeleton rowCount={4} />
      </SingleColumnPage>
    )
  }

  if (!store) {
    return (
      <SingleColumnPage>
        <Container className="p-6">
          <Text className="text-ui-fg-subtle">No store found. Create a store first.</Text>
        </Container>
      </SingleColumnPage>
    )
  }

  return (
    <SingleColumnPage>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Payment Providers</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Payment providers available for your store. Contact support to configure custom credentials.
          </Text>
        </div>

        <div className="divide-y">
          {providers.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Text className="text-ui-fg-subtle">No payment providers available.</Text>
            </div>
          ) : (
            providers.map((provider) => {
              const info = PROVIDER_INFO[provider.id] || {
                name: provider.id,
                description: "Payment provider",
                region: "—",
              }

              return (
                <div key={provider.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-x-2">
                        <Text weight="plus">{info.name}</Text>
                        <Badge size="2xsmall" color={provider.is_enabled ? "green" : "grey"}>
                          {provider.is_enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Badge size="2xsmall" color="blue">
                          {info.region}
                        </Badge>
                      </div>
                      <Text size="small" className="text-ui-fg-subtle mt-1">
                        {info.description}
                      </Text>
                    </div>
                  </div>

                  {provider.id === "pp_payu_payu" && provider.is_enabled && (
                    <div className="mt-3 p-3 rounded-lg bg-ui-bg-subtle">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        PayU is configured globally. To use your own PayU merchant credentials,
                        contact the platform administrator.
                      </Text>
                    </div>
                  )}

                  {provider.id === "pp_stripe_stripe" && provider.is_enabled && (
                    <div className="mt-3 p-3 rounded-lg bg-ui-bg-subtle">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Stripe is configured globally. For Stripe Connect (your own Stripe account),
                        contact the platform administrator.
                      </Text>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </Container>

      <Container className="divide-y p-0 mt-4">
        <div className="px-6 py-4">
          <Heading level="h2">Region Configuration</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Payment providers linked to your store's default region determine which payment methods your customers see at checkout.
          </Text>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Go to <a href="/settings/regions" className="text-ui-fg-interactive hover:underline">Regions</a> to manage which payment providers are linked to each region.
          </Text>
        </div>
      </Container>
    </SingleColumnPage>
  )
}
