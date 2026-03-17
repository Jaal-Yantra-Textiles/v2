import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"

import { Fragment } from "react"
import { SingleColumnPage } from "../../../components/layout/pages"
import { GeneralSectionSkeleton, Skeleton } from "../../../components/common/skeleton"
import {
  usePartnerSubscription,
  useSubscribeToPlan,
  useCancelSubscription,
  PartnerPlan,
} from "../../../hooks/api/subscription"

function formatPrice(price: number, currency: string) {
  if (price === 0) return "Free"
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(price)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const FEATURE_LABELS: Record<string, string> = {
  max_pages: "Pages",
  max_products: "Products",
  custom_domain: "Custom Domain",
  theme_customization: "Theme Customization",
  analytics: "Analytics",
  priority_support: "Priority Support",
}

function renderFeatureValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return value === -1 ? "Unlimited" : String(value)
  if (typeof value === "string") {
    return value.charAt(0).toUpperCase() + value.slice(1)
  }
  return String(value)
}

const PlanCard = ({
  plan,
  isCurrentPlan,
  onSelect,
  isLoading,
}: {
  plan: PartnerPlan
  isCurrentPlan: boolean
  onSelect: () => void
  isLoading: boolean
}) => {
  const features = (plan.features || {}) as Record<string, unknown>

  return (
    <Container className="divide-y p-0 relative">
      {isCurrentPlan && (
        <div className="absolute top-3 right-3">
          <Badge color="green" size="2xsmall">
            Current Plan
          </Badge>
        </div>
      )}
      <div className="px-6 py-4">
        <Heading level="h2">{plan.name}</Heading>
        <div className="flex items-baseline gap-1 mt-1">
          <Text className="text-2xl font-semibold">
            {formatPrice(plan.price, plan.currency_code)}
          </Text>
          {plan.price > 0 && (
            <Text size="small" className="text-ui-fg-subtle">
              /{plan.interval}
            </Text>
          )}
        </div>
        {plan.description && (
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {plan.description}
          </Text>
        )}
      </div>
      <div className="px-6 py-4 space-y-2">
        {Object.entries(features).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              {FEATURE_LABELS[key] || key}
            </Text>
            <Text size="small" className="font-medium">
              {renderFeatureValue(key, value)}
            </Text>
          </div>
        ))}
      </div>
      <div className="px-6 py-4">
        {isCurrentPlan ? (
          <Button variant="secondary" size="small" disabled className="w-full">
            Current Plan
          </Button>
        ) : (
          <Button
            size="small"
            className="w-full"
            onClick={onSelect}
            isLoading={isLoading}
          >
            {plan.price === 0 ? "Switch to Free" : `Upgrade to ${plan.name}`}
          </Button>
        )}
      </div>
    </Container>
  )
}

export const SettingsPlan = () => {
  const { subscription, plans, isPending, isError, error } =
    usePartnerSubscription()
  const { mutateAsync: subscribe, isPending: isSubscribing } =
    useSubscribeToPlan()
  const { mutateAsync: cancel, isPending: isCanceling } =
    useCancelSubscription()
  const prompt = usePrompt()

  if (isError) {
    throw error
  }

  const handleSelectPlan = async (plan: PartnerPlan) => {
    const confirmed = await prompt({
      title: `Switch to ${plan.name}`,
      description:
        plan.price > 0
          ? `You will be charged ${formatPrice(plan.price, plan.currency_code)}/${plan.interval}. Your current plan will be replaced.`
          : "You will switch to the free plan. Your current plan will be canceled.",
      confirmText: plan.price > 0 ? "Upgrade" : "Switch",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    try {
      await subscribe({ plan_id: plan.id })
      toast.success(`Switched to ${plan.name}`)
    } catch (e: any) {
      toast.error("Could not switch plan", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel Subscription",
      description:
        "Are you sure you want to cancel your subscription? You can re-subscribe at any time.",
      confirmText: "Cancel Subscription",
      cancelText: "Keep Plan",
    })

    if (!confirmed) return

    try {
      await cancel()
      toast.success("Subscription canceled")
    } catch (e: any) {
      toast.error("Could not cancel", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      {/* Current Subscription */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Plan & Billing</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage your subscription plan
          </Text>
        </div>
        <div className="px-6 py-4">
          {isPending ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Fragment key={i}>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </Fragment>
                ))}
              </div>
            </div>
          ) : subscription ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-y-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Plan
                </Text>
                <div className="flex items-center gap-2">
                  <Text size="small" className="font-medium">
                    {(subscription.plan as any)?.name || "-"}
                  </Text>
                  <Badge
                    color={subscription.status === "active" ? "green" : "orange"}
                    size="2xsmall"
                  >
                    {subscription.status}
                  </Badge>
                </div>

                <Text size="small" className="text-ui-fg-subtle">
                  Price
                </Text>
                <Text size="small">
                  {subscription.plan
                    ? formatPrice(
                        (subscription.plan as any).price,
                        (subscription.plan as any).currency_code
                      )
                    : "-"}
                  {subscription.plan && (subscription.plan as any).price > 0
                    ? `/${(subscription.plan as any).interval}`
                    : ""}
                </Text>

                <Text size="small" className="text-ui-fg-subtle">
                  Current Period
                </Text>
                <Text size="small">
                  {formatDate(subscription.current_period_start)} -{" "}
                  {formatDate(subscription.current_period_end)}
                </Text>
              </div>

              {subscription.status === "active" &&
                subscription.plan &&
                (subscription.plan as any).price > 0 && (
                  <Button
                    variant="danger"
                    size="small"
                    onClick={handleCancel}
                    isLoading={isCanceling}
                  >
                    Cancel Subscription
                  </Button>
                )}
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              No active subscription. Choose a plan below.
            </Text>
          )}
        </div>
      </Container>

      {/* Available Plans */}
      {!isPending && plans.length > 0 && (
        <div>
          <Heading level="h2" className="mb-4">
            Available Plans
          </Heading>
          <div className="grid grid-cols-1 small:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrentPlan={
                  subscription?.plan?.id === plan.id &&
                  subscription?.status === "active"
                }
                onSelect={() => handleSelectPlan(plan)}
                isLoading={isSubscribing}
              />
            ))}
          </div>
        </div>
      )}
    </SingleColumnPage>
  )
}
