import { Container, Heading, Text } from "@medusajs/ui"
import Setup from "../components/setup/setup"
import CreateStoreModal from "./components/create-store-modal"
import {
  createPartnerStore,
  getDetails,
  getPartnerCurrencies,
  getPartnerDesigns,
  getPartnerInventoryOrders,
  getPartnerStores,
  getPartnerTasks,
} from "./actions"
import Link from "next/link"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Dashboard() {
  const partner = await getDetails()

  if (!partner?.id) {
    redirect("/login")
  }

  const [storesRes, tasksRes, inventoryOrdersRes, designsRes, currenciesRes] =
    await Promise.all([
      getPartnerStores(),
      getPartnerTasks(),
      getPartnerInventoryOrders({ limit: 50, offset: 0 }),
      getPartnerDesigns({ limit: 50, offset: 0 }),
      getPartnerCurrencies({ limit: 100, offset: 0 }),
    ])

  const store = storesRes?.stores?.[0]
  const hasStore = !!store

  const tasks = tasksRes?.tasks || []
  const tasksCount = tasksRes?.count || tasks.length
  const tasksCompleted = tasks.filter((t) => t.status === "completed").length
  const tasksPending = tasks.filter((t) => t.status === "pending").length

  const inventoryOrders: unknown[] = inventoryOrdersRes?.inventory_orders || []
  const inventoryOrdersCount = inventoryOrdersRes?.count || inventoryOrders.length

  const getString = (v: unknown) => (typeof v === "string" ? v : "")

  const inventoryOrdersPending = inventoryOrders.filter((o) => {
    const s = getString((o as { status?: unknown })?.status).toLowerCase()
    return s === "pending" || s === "assigned" || s === "incoming"
  }).length

  const designs: unknown[] = designsRes?.designs || []
  const designsCount = designsRes?.count || designs.length
  const designsInProgress = designs.filter((d) => {
    const ps = getString(
      (d as { partner_info?: { partner_status?: unknown } })?.partner_info
        ?.partner_status
    ).toLowerCase()
    return ps === "in_progress" || ps === "assigned" || ps === "incoming" || ps === "finished"
  }).length

  const needsSetup = Boolean(!partner.is_verified)

  async function createStoreAction(formData: FormData) {
    "use server"

    const storeName = String(formData.get("store_name") || "").trim()
    const salesChannelName =
      String(formData.get("sales_channel_name") || "").trim() ||
      `${storeName} - Default`
    const regionName = String(formData.get("region_name") || "Primary Region").trim()
    const currencyCode = String(formData.get("currency_code") || "").toLowerCase()
    const countriesRaw = String(formData.get("countries") || "us")
    const locationName = String(formData.get("location_name") || "Main Warehouse").trim()
    const address1 = String(formData.get("address_1") || "").trim()
    const city = String(formData.get("city") || "").trim()
    const postal = String(formData.get("postal_code") || "").trim()
    const countryCode = String(formData.get("country_code") || "US").toUpperCase()

    if (!storeName || !currencyCode || !address1) {
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

  return (
    <Container className="space-y-8">
      <div>
        <Heading level="h2">Dashboard</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Overview of your partner workspace.
        </Text>
      </div>

      {needsSetup ? <Setup partnerId={partner.id} /> : null}

      {!hasStore ? (
        <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
          <Heading level="h3" className="text-base">
            Create your store
          </Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            You don’t have a store yet. Create one to unlock publishing, inventory assignments, and sales channels.
          </Text>
          <div className="mt-4">
            <CreateStoreModal
              currencies={currenciesRes.currencies}
              createStoreAction={createStoreAction}
              disabled={!partner.id}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
          <Text size="small" className="text-ui-fg-subtle">Tasks</Text>
          <Text weight="plus" className="mt-1">{tasksCompleted} achieved</Text>
          <Text size="small" className="text-ui-fg-subtle">{tasksCount} total</Text>
        </div>

        <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
          <Text size="small" className="text-ui-fg-subtle">Inventory Orders</Text>
          <Text weight="plus" className="mt-1">{inventoryOrdersCount}</Text>
          <Text size="small" className="text-ui-fg-subtle">assigned to you</Text>
        </div>

        <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
          <Text size="small" className="text-ui-fg-subtle">Designs</Text>
          <Text weight="plus" className="mt-1">{designsCount}</Text>
          <Text size="small" className="text-ui-fg-subtle">assigned to you</Text>
        </div>

        <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
          <Text size="small" className="text-ui-fg-subtle">Store</Text>
          <Text weight="plus" className="mt-1">{store?.name || partner.name}</Text>
          <Text size="small" className="text-ui-fg-subtle">{hasStore ? "Active" : "Not created"}</Text>
        </div>
      </div>

      <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
        <Heading level="h3" className="text-base">
          Pending actions
        </Heading>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Link
            href="/dashboard/tasks"
            className="rounded-md border border-ui-border-base p-4 hover:bg-ui-bg-base-hover transition-colors"
          >
            <Text weight="plus">Tasks to accept</Text>
            <Text size="small" className="text-ui-fg-subtle">{tasksPending}</Text>
          </Link>
          <Link
            href="/dashboard/inventory-orders"
            className="rounded-md border border-ui-border-base p-4 hover:bg-ui-bg-base-hover transition-colors"
          >
            <Text weight="plus">Inventory orders pending</Text>
            <Text size="small" className="text-ui-fg-subtle">{inventoryOrdersPending}</Text>
          </Link>
          <Link
            href="/dashboard/designs"
            className="rounded-md border border-ui-border-base p-4 hover:bg-ui-bg-base-hover transition-colors"
          >
            <Text weight="plus">Designs in progress</Text>
            <Text size="small" className="text-ui-fg-subtle">{designsInProgress}</Text>
          </Link>
        </div>
      </div>
    </Container>
  )
}
