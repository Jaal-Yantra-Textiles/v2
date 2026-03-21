import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"

import { Fragment, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
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

// New feature labels matching the revamped plan structure
const FEATURE_ROWS: Array<{
  key: string
  label: string
  render?: (val: unknown) => string
}> = [
  { key: "unlimited_products", label: "Products" },
  { key: "unlimited_selling", label: "Selling" },
  { key: "unlimited_staff", label: "Staff Accounts" },
  { key: "storefront_source_code", label: "Storefront Source Code" },
  { key: "custom_domain", label: "Custom Domain" },
  { key: "theme_customization", label: "Theme Editor" },
  { key: "jyt_emails", label: "JYT Emails" },
  { key: "live_shipping", label: "Live Shipping" },
  {
    key: "payment_processing_fee",
    label: "Payment Fee",
    render: (val) => (typeof val === "string" ? val : "-"),
  },
  {
    key: "analytics",
    label: "Analytics",
    render: (val) => {
      if (val === "advanced") return "Advanced"
      if (val === "basic") return "Basic"
      return typeof val === "boolean" ? (val ? "Yes" : "No") : String(val || "-")
    },
  },
  { key: "ai_chat_support", label: "AI Chat Support" },
  { key: "custom_modules", label: "Custom Modules" },
  { key: "custom_apis", label: "Custom APIs" },
  { key: "priority_support", label: "Priority Support" },
  { key: "white_label", label: "White Label" },
]

function renderFeatureValue(key: string, value: unknown, customRender?: (val: unknown) => string): string {
  if (customRender) return customRender(value)
  if (typeof value === "boolean") return value ? "Unlimited" : "-"
  if (typeof value === "number") return value === -1 ? "Unlimited" : String(value)
  if (typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1)
  if (Array.isArray(value)) return value.map(v => String(v).charAt(0).toUpperCase() + String(v).slice(1)).join(", ")
  return String(value ?? "-")
}

function featureSummary(features: Record<string, unknown>): string {
  const parts: string[] = []
  if (features.unlimited_products) parts.push("Unlimited products")
  if (features.unlimited_staff) parts.push("Unlimited staff")
  if (features.payment_processing_fee) parts.push(`${features.payment_processing_fee} fee`)
  if (features.ai_chat_support) parts.push("AI support")
  if (features.custom_modules) parts.push("Custom modules")
  if (features.priority_support) parts.push("Priority support")
  return parts.join(" · ")
}

const planColor = (slug: string): "grey" | "blue" | "purple" => {
  if (slug === "growth") return "blue"
  if (slug === "enterprise") return "purple"
  return "grey"
}

export const SettingsPlan = () => {
  const { subscription, plans, recommended_provider, isPending, isError, error } =
    usePartnerSubscription()
  const { mutateAsync: subscribe, isPending: isSubscribing } =
    useSubscribeToPlan()
  const { mutateAsync: cancel, isPending: isCanceling } =
    useCancelSubscription()
  const prompt = usePrompt()

  const [searchParams, setSearchParams] = useSearchParams()

  // Handle payment return (from PayU/Stripe redirect)
  useEffect(() => {
    const payment = searchParams.get("payment")
    if (!payment) return

    if (payment === "success") {
      toast.success("Payment successful! Your plan has been activated.")
    } else if (payment === "failed") {
      toast.error("Payment failed. Please try again.")
    } else if (payment === "canceled") {
      toast.info("Payment was canceled.")
    } else if (payment === "error") {
      const message = searchParams.get("message")
      toast.error(`Payment error: ${message || "Unknown error"}`)
    }

    // Clean up URL params
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  if (isError) throw error

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
        "Are you sure? You'll keep access until the end of your billing period. You can re-subscribe at any time.",
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
            Choose the plan that fits your business
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
                <Text size="small" className="text-ui-fg-subtle">Plan</Text>
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

                <Text size="small" className="text-ui-fg-subtle">Price</Text>
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

                <Text size="small" className="text-ui-fg-subtle">Period</Text>
                <Text size="small">
                  {formatDate(subscription.current_period_start)} -{" "}
                  {formatDate(subscription.current_period_end)}
                </Text>

                <Text size="small" className="text-ui-fg-subtle">Payment</Text>
                <Badge color="grey" size="2xsmall">
                  {recommended_provider === "payu" ? "PayU (India)" : "Stripe (International)"}
                </Badge>
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
              No active subscription. Choose a plan below to get started.
            </Text>
          )}
        </div>
      </Container>

      {/* Plan cards */}
      {!isPending && plans.length > 0 && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Heading level="h2">Choose Your Plan</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              All plans include unlimited products, staff accounts, and live shipping. No limits on selling.
            </Text>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-x divide-ui-border-base">
            {plans.map((plan) => {
              const isCurrentPlan = currentPlanId === plan.id
              const features = (plan.features || {}) as Record<string, unknown>
              const slug = (plan as any).slug || plan.name.toLowerCase()

              return (
                <div
                  key={plan.id}
                  className={`p-6 flex flex-col ${isCurrentPlan ? "bg-ui-bg-highlight" : ""}`}
                >
                  {/* Plan header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Text className="font-semibold text-lg">{plan.name}</Text>
                      {isCurrentPlan && (
                        <Badge color="green" size="2xsmall">Current</Badge>
                      )}
                      {slug === "growth" && !isCurrentPlan && (
                        <Badge color="blue" size="2xsmall">Popular</Badge>
                      )}
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {plan.description || ""}
                    </Text>
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <span className="text-2xl font-bold">
                      {formatPrice(plan.price, plan.currency_code)}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-sm text-ui-fg-subtle">/{plan.interval}</span>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="mb-6">
                    {isCurrentPlan ? (
                      <Button variant="secondary" size="small" disabled className="w-full">
                        Current Plan
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        className="w-full"
                        onClick={() => handleSelectPlan(plan)}
                        isLoading={isSubscribing}
                      >
                        {plan.price === 0 ? "Get Started" : plan.price < ((subscription?.plan as any)?.price || 0) ? "Downgrade" : "Upgrade"}
                      </Button>
                    )}
                  </div>

                  {/* Features list */}
                  <div className="space-y-2 flex-1">
                    <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase tracking-wide">
                      What's included
                    </Text>
                    <ul className="space-y-1.5">
                      {features.unlimited_products && (
                        <FeatureItem text="Unlimited products" included />
                      )}
                      {features.unlimited_selling && (
                        <FeatureItem text="Unlimited selling" included />
                      )}
                      {features.unlimited_staff && (
                        <FeatureItem text="Unlimited staff accounts" included />
                      )}
                      {features.storefront_source_code && (
                        <FeatureItem text="Storefront source code" included />
                      )}
                      {features.custom_domain && (
                        <FeatureItem text="Custom domain" included />
                      )}
                      {features.jyt_emails && (
                        <FeatureItem text="JYT Emails" included />
                      )}
                      {features.live_shipping && (
                        <FeatureItem text="Live shipping (Delhivery, DHL, UPS, FedEx)" included />
                      )}
                      {features.payment_processing_fee && (
                        <FeatureItem
                          text={`${features.payment_processing_fee} payment processing fee`}
                          included
                        />
                      )}
                      {features.analytics && (
                        <FeatureItem
                          text={`${features.analytics === "advanced" ? "Advanced" : "Basic"} analytics`}
                          included
                        />
                      )}
                      <FeatureItem
                        text="AI chat support"
                        included={!!features.ai_chat_support}
                      />
                      <FeatureItem
                        text="Custom modules"
                        included={!!features.custom_modules}
                      />
                      <FeatureItem
                        text="Custom APIs"
                        included={!!features.custom_apis}
                      />
                      <FeatureItem
                        text="Priority support"
                        included={!!features.priority_support}
                      />
                      <FeatureItem
                        text="White label"
                        included={!!features.white_label}
                      />
                    </ul>
                  </div>
                </div>
              )
            })}
          </div>
        </Container>
      )}

      {/* Feature comparison table */}
      {!isPending && plans.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Feature Comparison</Heading>
          </div>
          <div className="px-6 py-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border-base">
                  <th className="text-left py-2 text-ui-fg-subtle font-normal w-[200px]">
                    Feature
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.id}
                      className={`text-center py-2 font-medium ${
                        currentPlanId === plan.id ? "text-ui-fg-interactive" : ""
                      }`}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map(({ key, label, render }) => (
                  <tr key={key} className="border-b border-ui-border-base last:border-0">
                    <td className="py-2 text-ui-fg-subtle">{label}</td>
                    {plans.map((plan) => {
                      const features = (plan.features || {}) as Record<string, unknown>
                      const val = features[key]
                      return (
                        <td
                          key={plan.id}
                          className={`text-center py-2 ${
                            currentPlanId === plan.id ? "font-medium" : ""
                          }`}
                        >
                          {renderFeatureValue(key, val, render)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-ui-border-base">
                  <td className="py-2 text-ui-fg-subtle font-medium">Price</td>
                  {plans.map((plan) => (
                    <td
                      key={plan.id}
                      className={`text-center py-2 font-semibold ${
                        currentPlanId === plan.id ? "text-ui-fg-interactive" : ""
                      }`}
                    >
                      {formatPrice(plan.price, plan.currency_code)}
                      {plan.price > 0 && (
                        <span className="text-xs font-normal text-ui-fg-muted">
                          /{plan.interval}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Container>
      )}

      {/* Payment info */}
      <Container className="p-0">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Payments processed via {recommended_provider === "payu" ? "PayU (India)" : "Stripe (International)"}.
            The payment processing fee applies only when customers pay through JYT payment gateways.
            You can bring your own payment provider credentials to bypass platform fees.
          </Text>
        </div>
      </Container>
    </SingleColumnPage>
  )
}

function FeatureItem({ text, included }: { text: string; included: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={included ? "text-green-600" : "text-ui-fg-disabled"}>
        {included ? "✓" : "—"}
      </span>
      <span className={included ? "text-ui-fg-base" : "text-ui-fg-disabled"}>
        {text}
      </span>
    </li>
  )
}
