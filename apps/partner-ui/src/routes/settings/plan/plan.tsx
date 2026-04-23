import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"

import { Fragment, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { SingleColumnPage } from "../../../components/layout/pages"
import { GeneralSectionSkeleton, Skeleton } from "../../../components/common/skeleton"
import {
  usePartnerSubscription,
  useSubscribeToPlan,
  useCancelSubscription,
  PartnerPlan,
} from "../../../hooks/api/subscription"

function formatPrice(price: number, currency: string, freeLabel: string) {
  if (price === 0) return freeLabel
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

function renderFeatureValueFactory(
  t: (k: string) => string
) {
  return function renderFeatureValue(
    _key: string,
    value: unknown,
    customRender?: (val: unknown) => string
  ): string {
    if (customRender) return customRender(value)
    if (typeof value === "boolean") return value ? t("partner.plan.comparison.values.unlimited") : "-"
    if (typeof value === "number") return value === -1 ? t("partner.plan.comparison.values.unlimited") : String(value)
    if (typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1)
    if (Array.isArray(value)) return value.map(v => String(v).charAt(0).toUpperCase() + String(v).slice(1)).join(", ")
    return String(value ?? "-")
  }
}

const planColor = (slug: string): "grey" | "blue" | "purple" => {
  if (slug === "growth") return "blue"
  if (slug === "enterprise") return "purple"
  return "grey"
}

export const SettingsPlan = () => {
  const { t } = useTranslation()
  const { subscription, plans, recommended_provider, isPending, isError, error } =
    usePartnerSubscription()
  const { mutateAsync: subscribe, isPending: isSubscribing } =
    useSubscribeToPlan()
  const { mutateAsync: cancel, isPending: isCanceling } =
    useCancelSubscription()
  const prompt = usePrompt()

  const [searchParams, setSearchParams] = useSearchParams()

  const FEATURE_ROWS = useMemo(
    () => [
      { key: "unlimited_products", label: t("partner.plan.comparison.rows.unlimitedProducts") },
      { key: "unlimited_selling", label: t("partner.plan.comparison.rows.unlimitedSelling") },
      { key: "unlimited_staff", label: t("partner.plan.comparison.rows.unlimitedStaff") },
      { key: "storefront_source_code", label: t("partner.plan.comparison.rows.storefrontSource") },
      { key: "custom_domain", label: t("partner.plan.comparison.rows.customDomain") },
      { key: "theme_customization", label: t("partner.plan.comparison.rows.themeCustomization") },
      { key: "jyt_emails", label: t("partner.plan.comparison.rows.jytEmails") },
      { key: "live_shipping", label: t("partner.plan.comparison.rows.liveShipping") },
      {
        key: "payment_processing_fee",
        label: t("partner.plan.comparison.rows.paymentFee"),
        render: (val: unknown) => (typeof val === "string" ? val : "-"),
      },
      {
        key: "analytics",
        label: t("partner.plan.comparison.rows.analytics"),
        render: (val: unknown) => {
          if (val === "advanced") return t("partner.plan.comparison.values.analyticsAdvanced")
          if (val === "basic") return t("partner.plan.comparison.values.analyticsBasic")
          return typeof val === "boolean"
            ? val
              ? t("partner.plan.comparison.values.yes")
              : t("partner.plan.comparison.values.no")
            : String(val || "-")
        },
      },
      { key: "ai_chat_support", label: t("partner.plan.comparison.rows.aiChatSupport") },
      { key: "custom_modules", label: t("partner.plan.comparison.rows.customModules") },
      { key: "custom_apis", label: t("partner.plan.comparison.rows.customApis") },
      { key: "priority_support", label: t("partner.plan.comparison.rows.prioritySupport") },
      { key: "white_label", label: t("partner.plan.comparison.rows.whiteLabel") },
    ],
    [t]
  )

  const renderFeatureValue = useMemo(() => renderFeatureValueFactory(t), [t])
  const freeLabel = t("partner.plan.comparison.values.free")
  const fmt = (price: number, currency: string) => formatPrice(price, currency, freeLabel)
  const providerLabel =
    recommended_provider === "payu"
      ? t("partner.plan.providerPayu")
      : t("partner.plan.providerStripe")

  // Handle payment return (from PayU/Stripe redirect)
  useEffect(() => {
    const payment = searchParams.get("payment")
    if (!payment) return

    if (payment === "success") {
      toast.success(t("partner.plan.toast.paymentSuccess"))
    } else if (payment === "failed") {
      toast.error(t("partner.plan.toast.paymentFailed"))
    } else if (payment === "canceled") {
      toast.info(t("partner.plan.toast.paymentCanceled"))
    } else if (payment === "error") {
      const message = searchParams.get("message")
      toast.error(
        t("partner.plan.toast.paymentError", {
          message: message || t("partner.plan.toast.paymentUnknown"),
        })
      )
    }

    // Clean up URL params
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams, t])

  if (isError) throw error

  const handleSelectPlan = async (plan: PartnerPlan) => {
    const payProviderShort = recommended_provider === "payu" ? "PayU" : "Stripe"
    const confirmed = await prompt({
      title: t("partner.plan.prompts.switchTitle", { plan: plan.name }),
      description:
        plan.price > 0
          ? t("partner.plan.prompts.switchPaidDescription", {
              price: fmt(plan.price, plan.currency_code),
              interval: plan.interval,
              provider: payProviderShort,
            })
          : t("partner.plan.prompts.switchFreeDescription"),
      confirmText:
        plan.price > 0
          ? t("partner.plan.prompts.payWith", { provider: payProviderShort })
          : t("partner.plan.prompts.switch"),
      cancelText: t("partner.plan.prompts.cancel"),
    })
    if (!confirmed) return

    try {
      await subscribe({ plan_id: plan.id })
      toast.success(t("partner.plan.toast.switchedTo", { plan: plan.name }))
    } catch (e: any) {
      toast.error(t("partner.plan.toast.switchFailed"), {
        description: e?.message || t("partner.plan.toast.somethingWrong"),
      })
    }
  }

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: t("partner.plan.prompts.cancelTitle"),
      description: t("partner.plan.prompts.cancelDescription"),
      confirmText: t("partner.plan.prompts.cancelConfirm"),
      cancelText: t("partner.plan.prompts.keepPlan"),
    })
    if (!confirmed) return

    try {
      await cancel()
      toast.success(t("partner.plan.toast.canceled"))
    } catch (e: any) {
      toast.error(t("partner.plan.toast.cancelFailed"), {
        description: e?.message || t("partner.plan.toast.somethingWrong"),
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
          <Heading>{t("partner.plan.heading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.plan.description")}
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
                  {t("partner.plan.labels.plan")}
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
                  {t("partner.plan.labels.price")}
                </Text>
                <Text size="small">
                  {subscription.plan
                    ? fmt(
                        (subscription.plan as any).price,
                        (subscription.plan as any).currency_code
                      )
                    : "-"}
                  {subscription.plan && (subscription.plan as any).price > 0
                    ? `/${(subscription.plan as any).interval}`
                    : ""}
                </Text>

                <Text size="small" className="text-ui-fg-subtle">
                  {t("partner.plan.labels.period")}
                </Text>
                <Text size="small">
                  {formatDate(subscription.current_period_start)} -{" "}
                  {formatDate(subscription.current_period_end)}
                </Text>

                <Text size="small" className="text-ui-fg-subtle">
                  {t("partner.plan.labels.payment")}
                </Text>
                <Badge color="grey" size="2xsmall">
                  {providerLabel}
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
                    {t("partner.plan.cancelSubscription")}
                  </Button>
                )}
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.plan.noSubscription")}
            </Text>
          )}
        </div>
      </Container>

      {/* Plan cards */}
      {!isPending && plans.length > 0 && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Heading level="h2">{t("partner.plan.chooseHeading")}</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {t("partner.plan.chooseDescription")}
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
                        <Badge color="green" size="2xsmall">
                          {t("partner.plan.badges.current")}
                        </Badge>
                      )}
                      {slug === "growth" && !isCurrentPlan && (
                        <Badge color="blue" size="2xsmall">
                          {t("partner.plan.badges.popular")}
                        </Badge>
                      )}
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {plan.description || ""}
                    </Text>
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <span className="text-2xl font-bold">
                      {fmt(plan.price, plan.currency_code)}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-sm text-ui-fg-subtle">/{plan.interval}</span>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="mb-6">
                    {isCurrentPlan ? (
                      <Button variant="secondary" size="small" disabled className="w-full">
                        {t("partner.plan.currentPlan")}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        className="w-full"
                        onClick={() => handleSelectPlan(plan)}
                        isLoading={isSubscribing}
                      >
                        {plan.price === 0
                          ? t("partner.plan.cta.getStarted")
                          : plan.price < ((subscription?.plan as any)?.price || 0)
                            ? t("partner.plan.cta.downgrade")
                            : t("partner.plan.cta.upgrade")}
                      </Button>
                    )}
                  </div>

                  {/* Features list */}
                  <div className="space-y-2 flex-1">
                    <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase tracking-wide">
                      {t("partner.plan.whatsIncluded")}
                    </Text>
                    <ul className="space-y-1.5">
                      {features.unlimited_products && (
                        <FeatureItem text={t("partner.plan.features.unlimitedProducts")} included />
                      )}
                      {features.unlimited_selling && (
                        <FeatureItem text={t("partner.plan.features.unlimitedSelling")} included />
                      )}
                      {features.unlimited_staff && (
                        <FeatureItem text={t("partner.plan.features.unlimitedStaff")} included />
                      )}
                      {features.storefront_source_code && (
                        <FeatureItem text={t("partner.plan.features.storefrontSource")} included />
                      )}
                      {features.custom_domain && (
                        <FeatureItem text={t("partner.plan.features.customDomain")} included />
                      )}
                      {features.jyt_emails && (
                        <FeatureItem text={t("partner.plan.features.jytEmails")} included />
                      )}
                      {features.live_shipping && (
                        <FeatureItem text={t("partner.plan.features.liveShipping")} included />
                      )}
                      {features.payment_processing_fee && (
                        <FeatureItem
                          text={`${features.payment_processing_fee} ${t("partner.plan.features.paymentFeeSuffix")}`}
                          included
                        />
                      )}
                      {features.analytics && (
                        <FeatureItem
                          text={
                            features.analytics === "advanced"
                              ? t("partner.plan.features.analyticsAdvanced")
                              : t("partner.plan.features.analyticsBasic")
                          }
                          included
                        />
                      )}
                      <FeatureItem
                        text={t("partner.plan.features.aiChatSupport")}
                        included={!!features.ai_chat_support}
                      />
                      <FeatureItem
                        text={t("partner.plan.features.customModules")}
                        included={!!features.custom_modules}
                      />
                      <FeatureItem
                        text={t("partner.plan.features.customApis")}
                        included={!!features.custom_apis}
                      />
                      <FeatureItem
                        text={t("partner.plan.features.prioritySupport")}
                        included={!!features.priority_support}
                      />
                      <FeatureItem
                        text={t("partner.plan.features.whiteLabel")}
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
            <Heading level="h2">{t("partner.plan.comparison.heading")}</Heading>
          </div>
          <div className="px-6 py-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border-base">
                  <th className="text-left py-2 text-ui-fg-subtle font-normal w-[200px]">
                    {t("partner.plan.comparison.featureColumn")}
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
                  <td className="py-2 text-ui-fg-subtle font-medium">
                    {t("partner.plan.comparison.priceRow")}
                  </td>
                  {plans.map((plan) => (
                    <td
                      key={plan.id}
                      className={`text-center py-2 font-semibold ${
                        currentPlanId === plan.id ? "text-ui-fg-interactive" : ""
                      }`}
                    >
                      {fmt(plan.price, plan.currency_code)}
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
            {t("partner.plan.paymentInfo", { provider: providerLabel })}
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
