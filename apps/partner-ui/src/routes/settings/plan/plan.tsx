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
  theme_customization: "Theme",
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

function featureSummary(features: Record<string, unknown>): string {
  const parts: string[] = []
  const pages = features.max_pages
  const products = features.max_products
  if (typeof pages === "number") {
    parts.push(pages === -1 ? "Unlimited pages" : `${pages} pages`)
  }
  if (typeof products === "number") {
    parts.push(products === -1 ? "Unlimited products" : `${products} products`)
  }
  if (features.custom_domain) parts.push("Custom domain")
  if (features.analytics) parts.push("Analytics")
  if (features.priority_support) parts.push("Priority support")
  return parts.join(" · ")
}

export const SettingsPlan = () => {
  const { subscription, plans, recommended_provider, isPending, isError, error } =
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
    const providerLabel = recommended_provider === "payu" ? "PayU" : "Stripe"
    const confirmed = await prompt({
      title: `Switch to ${plan.name}`,
      description:
        plan.price > 0
          ? `You will be charged ${formatPrice(plan.price, plan.currency_code)}/${plan.interval} via ${providerLabel}. Your current plan will be replaced.`
          : "You will switch to the free plan. Your current plan will be canceled.",
      confirmText: plan.price > 0 ? `Pay with ${providerLabel}` : "Switch",
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

  const currentPlanId =
    subscription?.status === "active" ? subscription?.plan?.id : null

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
                  Period
                </Text>
                <Text size="small">
                  {formatDate(subscription.current_period_start)} -{" "}
                  {formatDate(subscription.current_period_end)}
                </Text>

                <Text size="small" className="text-ui-fg-subtle">
                  Payment
                </Text>
                <div className="flex items-center gap-2">
                  <Badge color="grey" size="2xsmall">
                    {recommended_provider === "payu" ? "PayU" : recommended_provider === "stripe" ? "Stripe" : "Manual"}
                  </Badge>
                </div>
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

      {/* Plans as compact rows */}
      {!isPending && plans.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Available Plans</Heading>
          </div>
          {plans.map((plan) => {
            const isCurrentPlan = currentPlanId === plan.id
            const features = (plan.features || {}) as Record<string, unknown>

            return (
              <div
                key={plan.id}
                className={`px-6 py-4 flex items-center gap-4 ${
                  isCurrentPlan ? "bg-ui-bg-highlight" : ""
                }`}
              >
                {/* Plan info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Text className="font-medium">{plan.name}</Text>
                    {isCurrentPlan && (
                      <Badge color="green" size="2xsmall">
                        Current
                      </Badge>
                    )}
                  </div>
                  <Text size="xsmall" className="text-ui-fg-muted truncate mt-0.5">
                    {featureSummary(features)}
                  </Text>
                </div>

                {/* Price */}
                <div className="text-right shrink-0 w-[100px]">
                  <Text className="font-semibold">
                    {formatPrice(plan.price, plan.currency_code)}
                  </Text>
                  {plan.price > 0 && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      /{plan.interval}
                    </Text>
                  )}
                </div>

                {/* Action */}
                <div className="shrink-0 w-[120px]">
                  {isCurrentPlan ? (
                    <Button
                      variant="secondary"
                      size="small"
                      disabled
                      className="w-full"
                    >
                      Current
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      className="w-full"
                      onClick={() => handleSelectPlan(plan)}
                      isLoading={isSubscribing}
                    >
                      {plan.price === 0 ? "Downgrade" : "Upgrade"}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </Container>
      )}

      {/* Plan comparison */}
      {!isPending && plans.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Feature Comparison</Heading>
          </div>
          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border-base">
                  <th className="text-left py-2 text-ui-fg-subtle font-normal">
                    Feature
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.id}
                      className={`text-center py-2 font-medium ${
                        currentPlanId === plan.id
                          ? "text-ui-fg-interactive"
                          : ""
                      }`}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(FEATURE_LABELS).map((key) => (
                  <tr key={key} className="border-b border-ui-border-base last:border-0">
                    <td className="py-2 text-ui-fg-subtle">
                      {FEATURE_LABELS[key]}
                    </td>
                    {plans.map((plan) => {
                      const features = (plan.features || {}) as Record<
                        string,
                        unknown
                      >
                      return (
                        <td
                          key={plan.id}
                          className={`text-center py-2 ${
                            currentPlanId === plan.id ? "font-medium" : ""
                          }`}
                        >
                          {renderFeatureValue(key, features[key])}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="py-2 text-ui-fg-subtle font-medium">Price</td>
                  {plans.map((plan) => (
                    <td
                      key={plan.id}
                      className={`text-center py-2 font-semibold ${
                        currentPlanId === plan.id
                          ? "text-ui-fg-interactive"
                          : ""
                      }`}
                    >
                      {formatPrice(plan.price, plan.currency_code)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Container>
      )}
    </SingleColumnPage>
  )
}
