import { Badge, Button, Checkbox, Container, FocusModal, Heading, Text, clx, toast } from "@medusajs/ui"
import { Outlet, useNavigate } from "react-router-dom"
import {
  ArrowPath,
  BuildingStorefront,
  CogSixTooth,
  CreditCard,
  CurrencyDollar,
  PencilSquare,
  Plus,
  ShoppingBag,
  TruckFast,
} from "@medusajs/icons"
import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { usePartnerAssignedTasks } from "../../hooks/api/partner-assigned-tasks"
import { usePartnerStores } from "../../hooks/api/partner-stores"
import { useMe } from "../../hooks/api/users"
import { useDiscoverProducts, useCopyProduct, DiscoverProduct } from "../../hooks/api/discover"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"

// ─── Main ────────────────────────────────────────────────────────────────────

export const Home = () => {
  const { user } = useMe()
  const partner = user?.partner
  const partnerId = user?.partner_id

  const navigate = useNavigate()
  const { stores, isPending: storesPending } = usePartnerStores()
  const store = stores?.[0]
  const hasStore = Boolean(store)

  const storageKey = useMemo(
    () => (partnerId ? `partner_onboarding_${partnerId}` : null),
    [partnerId]
  )

  // Track a render key so onboardingStatus re-evaluates after modal closes
  const [statusKey, setStatusKey] = useState(0)

  const onboardingStatus = useMemo(() => {
    if (!partnerId || !storageKey) return { completed: false, skipped: false }
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { completed: false, skipped: false }
      const parsed = JSON.parse(raw)
      return {
        completed: Boolean(parsed?.completed),
        skipped: Boolean(parsed?.skipped),
      }
    } catch {
      return { completed: false, skipped: false }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, storageKey, statusKey])

  useEffect(() => {
    if (!partnerId || !storageKey || partner?.is_verified) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) {
        navigate("/onboarding", { replace: true })
        return
      }
      const parsed = JSON.parse(raw)
      if (!parsed?.completed && !parsed?.skipped) {
        navigate("/onboarding", { replace: true })
      }
    } catch {
      navigate("/onboarding", { replace: true })
    }
  }, [partner?.is_verified, partnerId, storageKey, navigate])

  const verified = Boolean(partner?.is_verified)
  const onboardingDone = Boolean(onboardingStatus.completed || onboardingStatus.skipped)
  const currentUseType = (partner?.metadata as any)?.use_type as string | undefined

  return (
    <div className="flex flex-col gap-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading>Dashboard</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {store?.name
              ? store.name
              : partner?.name
                ? partner.name
                : "Welcome"}
          </Text>
        </div>
      </div>

      {/* Top row: Getting Started + Quick Settings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GettingStartedCard
          partnerId={partnerId}
          partner={partner}
          verified={verified}
          onboardingDone={onboardingDone}
          hasStore={hasStore}
          storesPending={storesPending}
          currentUseType={currentUseType}
          onOpenOnboarding={() => navigate("/onboarding")}
        />
        <QuickSettingsCard hasStore={hasStore} storeId={store?.id} />
      </div>

      {/* Bottom row: Discover Products (full width) */}
      {hasStore && <DiscoverSection />}

      <Outlet context={{ onOnboardingClose: () => setStatusKey((k) => k + 1) }} />
    </div>
  )
}

// ─── Getting Started Card ────────────────────────────────────────────────────

const GettingStartedCard = ({
  partnerId,
  partner,
  verified,
  onboardingDone,
  hasStore,
  storesPending,
  currentUseType,
  onOpenOnboarding,
}: {
  partnerId?: string
  partner: any
  verified: boolean
  onboardingDone: boolean
  hasStore: boolean
  storesPending: boolean
  currentUseType?: string
  onOpenOnboarding: () => void
}) => {
  const [savingUseType, setSavingUseType] = useState(false)

  const handleUseTypeChange = async (useType: string) => {
    if (useType === currentUseType) return
    setSavingUseType(true)
    try {
      await sdk.client.fetch("/partners/update", {
        method: "PUT",
        body: { metadata: { ...((partner?.metadata as any) || {}), use_type: useType } },
      })
      queryClient.invalidateQueries({ queryKey: ["users", "me"] })
    } catch (e) {
      console.error("Failed to update use type", e)
    } finally {
      setSavingUseType(false)
    }
  }

  const { tasks, count: tasksCount = 0 } = usePartnerAssignedTasks()
  const tasksPending = useMemo(
    () => (tasks || []).filter((t) => String(t.status || "") === "pending").length,
    [tasks]
  )
  const tasksTotal = tasksCount || (tasks || []).length

  const completedSteps = [
    onboardingDone,
    !!currentUseType,
    verified,
    hasStore,
  ].filter(Boolean).length
  const totalSteps = 4

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Getting Started</Heading>
          <Badge size="2xsmall" color={completedSteps === totalSteps ? "green" : "grey"}>
            {completedSteps}/{totalSteps}
          </Badge>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          Complete these steps to set up your workspace.
        </Text>
      </div>

      <div className="divide-y">
        <ChecklistItem
          done={onboardingDone}
          label="Complete onboarding"
          description="Add your details and team."
          action={
            !onboardingDone && partnerId ? (
              <button
                type="button"
                className="text-ui-fg-interactive whitespace-nowrap text-sm"
                onClick={onOpenOnboarding}
              >
                Open
              </button>
            ) : null
          }
        />

        <div className="flex items-start gap-3 p-4">
          <Checkbox checked={!!currentUseType} disabled className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <Text size="small" weight="plus">Choose workspace type</Text>
            {currentUseType ? (
              <div className="flex items-center gap-2 mt-0.5">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {currentUseType === "seller" ? "Seller" : "Manufacturer"}
                </Text>
                <Link to="/settings/onboarding" className="text-ui-fg-interactive">
                  <Text size="xsmall">Change</Text>
                </Link>
              </div>
            ) : (
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  disabled={savingUseType}
                  onClick={() => handleUseTypeChange("seller")}
                  className="flex items-center gap-1.5 rounded-md border border-ui-border-base px-2.5 py-1.5 text-xs hover:shadow-elevation-card-hover outline-none focus-visible:shadow-borders-focus"
                >
                  <BuildingStorefront className="h-3.5 w-3.5 text-ui-fg-subtle" />
                  Seller
                </button>
                <button
                  type="button"
                  disabled={savingUseType}
                  onClick={() => handleUseTypeChange("manufacturer")}
                  className="flex items-center gap-1.5 rounded-md border border-ui-border-base px-2.5 py-1.5 text-xs hover:shadow-elevation-card-hover outline-none focus-visible:shadow-borders-focus"
                >
                  <PencilSquare className="h-3.5 w-3.5 text-ui-fg-subtle" />
                  Manufacturer
                </button>
              </div>
            )}
          </div>
        </div>

        <ChecklistItem
          done={verified}
          label="Get verified"
          description="Upload verification documents."
          action={
            !verified ? (
              <Button size="small" variant="secondary" asChild>
                <Link to="/verification">Upload</Link>
              </Button>
            ) : null
          }
        />

        <ChecklistItem
          done={hasStore}
          label="Create a store"
          description="Unlock products, orders, and sales channels."
          action={
            !storesPending && !hasStore ? (
              <Button size="small" variant="secondary" asChild disabled={!partnerId}>
                <Link to="/create-store">Create</Link>
              </Button>
            ) : null
          }
        />
      </div>

      {hasStore && tasksTotal > 0 && (
        <div className="px-6 py-3 flex items-center justify-between">
          <Text size="xsmall" className="text-ui-fg-subtle">
            {tasksTotal} task{tasksTotal !== 1 ? "s" : ""} · {tasksPending} pending
          </Text>
          <Link to="/tasks" className="text-ui-fg-interactive text-xs">
            View tasks
          </Link>
        </div>
      )}
    </Container>
  )
}

const ChecklistItem = ({
  done,
  label,
  description,
  action,
}: {
  done: boolean
  label: string
  description: string
  action?: React.ReactNode
}) => (
  <div className="flex items-start gap-3 p-4">
    <Checkbox checked={done} disabled className="mt-0.5" />
    <div className="min-w-0 flex-1">
      <Text size="small" weight="plus">{label}</Text>
      <Text size="xsmall" className="text-ui-fg-subtle">{description}</Text>
    </div>
    {action}
  </div>
)

// ─── Quick Settings Card ─────────────────────────────────────────────────────

const QuickSettingsCard = ({
  hasStore,
  storeId,
}: {
  hasStore: boolean
  storeId?: string
}) => {
  const settingsItems = [
    {
      icon: <CreditCard className="h-5 w-5" />,
      label: "Payment Providers",
      description: "Configure how you get paid.",
      to: "/settings/payments",
    },
    {
      icon: <TruckFast className="h-5 w-5" />,
      label: "Shipping Setup",
      description: "Locations, zones, and rates.",
      to: "/settings/locations",
    },
    {
      icon: <CurrencyDollar className="h-5 w-5" />,
      label: "Tax Regions",
      description: "Configure tax rates by region.",
      to: "/settings/tax-regions",
    },
    {
      icon: <CogSixTooth className="h-5 w-5" />,
      label: "Store Settings",
      description: "Store details and storefront.",
      to: "/settings/store",
    },
  ]

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Quick Settings</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Manage your store configuration.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-0 divide-y sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
        {settingsItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={clx(
              "flex items-start gap-3 p-4 transition-colors",
              "hover:bg-ui-bg-base-hover",
              !hasStore && "pointer-events-none opacity-50"
            )}
          >
            <div className="text-ui-fg-subtle mt-0.5">{item.icon}</div>
            <div className="min-w-0">
              <Text size="small" weight="plus">{item.label}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {item.description}
              </Text>
            </div>
          </Link>
        ))}
      </div>
    </Container>
  )
}

// ─── Discover Products ───────────────────────────────────────────────────────

function getLowestPrice(product: DiscoverProduct): string | null {
  const prices = (product.variants || []).flatMap((v) => v.prices || [])
  if (!prices.length) return null
  const lowest = prices.reduce((min, p) => (p.amount < min.amount ? p : min))
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: lowest.currency_code?.toUpperCase() || "USD",
    minimumFractionDigits: 0,
  }).format(lowest.amount)
}

const DiscoverProductCard = ({ product }: { product: DiscoverProduct }) => {
  const { mutateAsync: copyProduct, isPending: isCopying } = useCopyProduct()

  const handleCopy = async () => {
    try {
      await copyProduct(product.id)
      toast.success("Product added to your store", {
        description: `"${product.title}" copied as draft.`,
      })
    } catch (e: any) {
      toast.error("Failed to copy product", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const price = getLowestPrice(product)
  const variantCount = product.variants?.length || 0

  return (
    <div className="bg-ui-bg-base border border-ui-border-base rounded-lg overflow-hidden flex flex-col">
      <div className="aspect-square bg-ui-bg-subtle relative">
        {product.thumbnail ? (
          <img
            src={product.thumbnail}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-8 w-8 text-ui-fg-muted" />
          </div>
        )}
        {product.type && (
          <Badge size="2xsmall" color="grey" className="absolute top-2 left-2">
            {product.type.value}
          </Badge>
        )}
      </div>
      <div className="p-3 flex flex-col gap-y-1 flex-1">
        <Text size="small" weight="plus" className="truncate">
          {product.title}
        </Text>
        <div className="flex items-center gap-x-2">
          {price && <Text size="small">{price}</Text>}
          <Text size="xsmall" className="text-ui-fg-muted">
            {variantCount} variant{variantCount !== 1 ? "s" : ""}
          </Text>
        </div>
      </div>
      <div className="px-3 pb-3">
        <Button
          variant="secondary"
          size="small"
          className="w-full"
          onClick={handleCopy}
          disabled={isCopying}
        >
          <Plus className="mr-1 h-3 w-3" />
          {isCopying ? "Copying..." : "Add to My Store"}
        </Button>
      </div>
    </div>
  )
}

/**
 * Compact discover card for the dashboard — shows stacked thumbnails
 * and opens a FocusModal with the full product grid.
 */
const DiscoverSection = () => {
  const { products, count, isPending, isError, refetch } =
    useDiscoverProducts({ limit: 8 })
  const [modalOpen, setModalOpen] = useState(false)

  if (isError) return null

  // Take first 3 for the stacked preview
  const previewProducts = (products || []).slice(0, 3)
  const totalCount = count || 0

  return (
    <>
      <Container className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-x-4 px-6 py-4 text-left transition-colors hover:bg-ui-bg-base-hover"
        >
          {/* Stacked thumbnails — z-index is scoped to this container via isolation */}
          <div className="relative h-16 w-24 shrink-0" style={{ isolation: "isolate" }}>
            {isPending ? (
              <div className="h-16 w-16 rounded-lg bg-ui-bg-subtle animate-pulse" />
            ) : previewProducts.length > 0 ? (
              previewProducts.map((p, i) => (
                <div
                  key={p.id}
                  className="absolute rounded-lg border-2 border-ui-bg-base bg-ui-bg-subtle overflow-hidden shadow-elevation-card-rest"
                  style={{
                    width: 52,
                    height: 52,
                    left: i * 14,
                    top: i * 4,
                    zIndex: previewProducts.length - i,
                  }}
                >
                  {p.thumbnail ? (
                    <img
                      src={p.thumbnail}
                      alt={p.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ShoppingBag className="h-4 w-4 text-ui-fg-muted" />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-ui-bg-subtle border border-ui-border-base">
                <ShoppingBag className="h-5 w-5 text-ui-fg-muted" />
              </div>
            )}
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-x-2">
              <Text size="small" weight="plus">
                Discover Products
              </Text>
              {totalCount > 0 && (
                <Badge size="2xsmall" color="blue">
                  {totalCount}
                </Badge>
              )}
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle mt-0.5">
              Cross-sell products from other partners or copy them to produce on
              your own.
            </Text>
          </div>

          {/* Arrow */}
          <Text size="small" className="text-ui-fg-muted shrink-0">
            &rsaquo;
          </Text>
        </button>
      </Container>

      {/* Full discover modal */}
      <FocusModal open={modalOpen} onOpenChange={setModalOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <div className="flex items-center justify-between w-full">
              <div>
                <FocusModal.Title asChild>
                  <Heading>Discover Products</Heading>
                </FocusModal.Title>
                <Text size="small" className="text-ui-fg-subtle mt-0.5">
                  Browse products from other partners. Add them to cross-sell directly,
                  or copy them as drafts to produce on your own.
                </Text>
              </div>
              <Button
                variant="transparent"
                size="small"
                onClick={() => refetch()}
                disabled={isPending}
              >
                <ArrowPath
                  className={clx("h-4 w-4", isPending && "animate-spin")}
                />
                Shuffle
              </Button>
            </div>
          </FocusModal.Header>

          <FocusModal.Body className="overflow-auto p-6">
            {isPending ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-ui-bg-subtle animate-pulse rounded-lg aspect-square"
                  />
                ))}
              </div>
            ) : !products?.length ? (
              <div className="flex flex-col items-center justify-center py-16 gap-y-2">
                <ShoppingBag className="h-8 w-8 text-ui-fg-muted" />
                <Text size="small" className="text-ui-fg-subtle">
                  No products available for discovery yet.
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Products will appear here when other partners publish them.
                </Text>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {products.map((product) => (
                    <DiscoverProductCard key={product.id} product={product} />
                  ))}
                </div>
                {totalCount > 8 && (
                  <Text
                    size="xsmall"
                    className="text-ui-fg-muted mt-4 text-center"
                  >
                    Showing 8 of {totalCount} products — click Shuffle to see
                    more
                  </Text>
                )}
              </>
            )}
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}
