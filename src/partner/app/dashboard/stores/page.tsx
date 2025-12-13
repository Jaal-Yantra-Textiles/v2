import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
} from "@medusajs/ui"
import { redirect } from "next/navigation"
import {
  createPartnerStore,
  getPartnerCurrencies,
  getPartnerStores,
  PartnerCurrency,
  PartnerStoreSummary,
} from "../actions"

export const dynamic = "force-dynamic"

type StorePageProps = {
  searchParams?: Promise<{ ref?: string }>
}

export default async function StoresPage({ searchParams }: StorePageProps) {
  void searchParams // reserved for future filters

  const [{ stores }, currencyRes] = await Promise.all([
    getPartnerStores(),
    getPartnerCurrencies({ limit: 100 }),
  ])

  return (
    <Container className="space-y-8">
      <div>
        <Heading level="h2">Stores</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Create and review the storefront connected to your partner workspace.
        </Text>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-4">
          {stores.length === 0 ? (
            <EmptyState />
          ) : (
            <StoreCollection stores={stores} />
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
            <Heading level="h3" className="text-base">
              Create store
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Provide baseline storefront details. Defaults can be edited later in settings.
            </Text>
            <form action={createStoreAction} className="mt-4 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="store_name">Store name</Label>
                <Input id="store_name" name="store_name" placeholder="Acme Home Store" required />
              </div>

              <div className="space-y-1">
                <Label htmlFor="sales_channel_name">Sales channel name</Label>
                <Input
                  id="sales_channel_name"
                  name="sales_channel_name"
                  placeholder="Acme Storefront"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="currency_code">Default currency</Label>
                <CurrencySelect
                  currencies={currencyRes.currencies}
                  defaultValue={currencyRes.currencies[0]?.code ?? "usd"}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="region_name">Region name</Label>
                <Input id="region_name" name="region_name" placeholder="North America" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="countries">Region countries</Label>
                <Input
                  id="countries"
                  name="countries"
                  placeholder="us, ca"
                  defaultValue="us"
                />
                <Text size="xsmall" className="text-ui-fg-muted">
                  Comma-separated ISO2 country codes.
                </Text>
              </div>

              <div className="space-y-1">
                <Label htmlFor="location_name">Default location name</Label>
                <Input id="location_name" name="location_name" placeholder="Main Warehouse" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="address_1">Address line</Label>
                <Input id="address_1" name="address_1" placeholder="123 Main St" required />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" placeholder="New York" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="postal_code">Postal code</Label>
                  <Input id="postal_code" name="postal_code" placeholder="10001" />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="country_code">Country code</Label>
                <Input
                  id="country_code"
                  name="country_code"
                  placeholder="US"
                  defaultValue="US"
                  maxLength={2}
                />
              </div>

              <Button className="w-full" type="submit">
                Create store
              </Button>
            </form>
          </div>
        </aside>
      </div>
    </Container>
  )
}

async function createStoreAction(formData: FormData) {
  "use server"

  const storeName = String(formData.get("store_name") || "").trim()
  const salesChannelName =
    String(formData.get("sales_channel_name") || "").trim() || `${storeName} - Default`
  const regionName = String(formData.get("region_name") || "Primary Region").trim()
  const currencyCode = String(formData.get("currency_code") || "").toLowerCase()
  const countriesRaw = String(formData.get("countries") || "us")
  const locationName = String(formData.get("location_name") || "Main Warehouse").trim()
  const address1 = String(formData.get("address_1") || "").trim()
  const city = String(formData.get("city") || "").trim()
  const postal = String(formData.get("postal_code") || "").trim()
  const countryCode = String(formData.get("country_code") || "US").toUpperCase()

  if (!storeName || !currencyCode || !address1) {
    // rely on browser validation for now—bail silently to avoid flashing errors
    return
  }

  await createPartnerStore({
    store: {
      name: storeName,
      supported_currencies: [{ currency_code: currencyCode, is_default: true }],
    },
    sales_channel: {
      name: salesChannelName,
      description: "Default partner sales channel",
    },
    region: {
      name: regionName,
      currency_code: currencyCode,
      countries: countriesRaw
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    },
    location: {
      name: locationName || "Main Warehouse",
      address: {
        address_1: address1,
        city: city || undefined,
        postal_code: postal || undefined,
        country_code: countryCode,
      },
    },
  })

  redirect("/dashboard/stores")
}

const EmptyState = () => (
  <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-ui-border-base bg-ui-bg-base p-10 text-center">
    <Heading level="h3" className="text-base">
      No stores yet
    </Heading>
    <Text className="text-ui-fg-subtle max-w-md">
      Create your first store to unlock product publishing, sales channels, and inventory
      assignments.
    </Text>
  </div>
)

const StoreCollection = ({ stores }: { stores: PartnerStoreSummary[] }) => (
  <div className="grid grid-cols-1 gap-4">
    {stores.map((store) => (
      <div key={store.id} className="rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
        <Heading level="h3" className="text-lg">
          {store.name}
        </Heading>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-ui-fg-subtle sm:grid-cols-2">
          <div>
            <Text weight="plus">Store ID</Text>
            <Text size="small" className="truncate text-ui-fg-muted">
              {store.id}
            </Text>
          </div>
          <div>
            <Text weight="plus">Currencies</Text>
            <Text size="small">
              {(store.supported_currencies || [])
                .map((c) => c.currency_code?.toUpperCase())
                .join(", ")}
            </Text>
          </div>
          <div>
            <Text weight="plus">Default sales channel</Text>
            <Text size="small" className="text-ui-fg-muted">
              {store.default_sales_channel_id || "Not configured"}
            </Text>
          </div>
          <div>
            <Text weight="plus">Default region</Text>
            <Text size="small" className="text-ui-fg-muted">
              {store.default_region_id || "Not configured"}
            </Text>
          </div>
        </dl>
      </div>
    ))}
  </div>
)

const CurrencySelect = ({
  currencies,
  defaultValue,
}: {
  currencies: PartnerCurrency[]
  defaultValue?: string
}) => (
  <select
    className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm"
    name="currency_code"
    defaultValue={defaultValue}
    required
  >
    {currencies.map((currency) => (
      <option key={currency.code} value={currency.code}>
        {currency.code.toUpperCase()} • {currency.name || "Currency"}
      </option>
    ))}
  </select>
)
