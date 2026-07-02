import { useMemo, useState } from "react"
import { Badge, Button, Heading, Text, clx } from "@medusajs/ui"
import {
  usePartnerSubscription,
  useSubscribeToPlan,
  type PartnerPlan,
} from "../../../hooks/api/subscription"

interface OnboardingPlanStepProps {
  /** The partner's billing currency (lower-case, e.g. "inr" | "eur"). */
  currencyCode: string
  /**
   * Persist the rest of the onboarding form BEFORE we leave for payment (a paid
   * plan redirects away to Stripe/PayU). Returns false to abort selection.
   */
  onBeforeSelect: () => Promise<boolean>
  /** Called after a FREE plan activates (no redirect happens). */
  onFreeActivated: () => void
}

const formatPrice = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency.toUpperCase()} ${amount}`
  }
}

/**
 * Plan-picker step for partner onboarding — surfaces subscription billing INSIDE
 * the wizard. Shows the plans that match the partner's billing currency (plus any
 * free plan), honoring a launch discount (`metadata.list_price` → strikethrough).
 * Selecting a paid plan persists the onboarding form, then hands off to the
 * existing /partners/subscription flow (Stripe for non-IN, PayU for IN) which
 * redirects to the hosted payment page.
 */
export const OnboardingPlanStep = ({
  currencyCode,
  onBeforeSelect,
  onFreeActivated,
}: OnboardingPlanStepProps) => {
  const { plans, isPending } = usePartnerSubscription()
  const { mutateAsync: subscribe } = useSubscribeToPlan()
  const [selectingId, setSelectingId] = useState<string | null>(null)

  // Show free plans to everyone; otherwise only plans priced in the partner's
  // billing currency (so an EU partner sees the EUR plan, an IN partner INR).
  const visiblePlans = useMemo(() => {
    const cc = currencyCode.toLowerCase()
    return (plans || [])
      .filter(
        (p) => p.is_active && (p.price === 0 || p.currency_code.toLowerCase() === cc)
      )
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [plans, currencyCode])

  const handleSelect = async (plan: PartnerPlan) => {
    setSelectingId(plan.id)
    try {
      const ok = await onBeforeSelect()
      if (!ok) return
      const res = await subscribe({ plan_id: plan.id })
      // Paid plans redirect away inside the hook; a returned subscription means a
      // free plan activated immediately with no redirect.
      if (res?.subscription) {
        onFreeActivated()
      }
    } finally {
      setSelectingId(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-y-4 py-10">
      <div>
        <Heading>Choose your plan</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Pick a plan to finish setting up. You can change or upgrade it any time
          from Settings.
        </Text>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-lg border border-ui-border-base bg-ui-bg-subtle"
            />
          ))}
        </div>
      ) : visiblePlans.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          No plans are available for your region yet — you can finish and choose a
          plan later from Settings.
        </Text>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {visiblePlans.map((plan) => {
            const meta = (plan.metadata as Record<string, any>) || {}
            const listPrice =
              typeof meta.list_price === "number" ? meta.list_price : null
            const hasDiscount = listPrice != null && listPrice > plan.price
            const isFree = plan.price === 0
            const busy = selectingId === plan.id
            return (
              <div
                key={plan.id}
                className={clx(
                  "flex flex-col gap-y-3 rounded-lg border p-4",
                  hasDiscount
                    ? "border-ui-border-interactive"
                    : "border-ui-border-base"
                )}
              >
                <div className="flex items-center justify-between">
                  <Text weight="plus">{plan.name}</Text>
                  {hasDiscount && (
                    <Badge size="2xsmall" color="green">
                      Launch offer
                    </Badge>
                  )}
                </div>

                <div className="flex items-baseline gap-x-2">
                  {isFree ? (
                    <Text size="xlarge" weight="plus">
                      Free
                    </Text>
                  ) : (
                    <>
                      <Text size="xlarge" weight="plus">
                        {formatPrice(plan.price, plan.currency_code)}
                      </Text>
                      {hasDiscount && (
                        <Text
                          size="small"
                          className="text-ui-fg-muted line-through"
                        >
                          {formatPrice(listPrice!, plan.currency_code)}
                        </Text>
                      )}
                      <Text size="small" className="text-ui-fg-subtle">
                        /{plan.interval}
                        {meta.tax_inclusive ? " · incl. tax" : ""}
                      </Text>
                    </>
                  )}
                </div>

                {plan.description && (
                  <Text size="small" className="text-ui-fg-subtle flex-1">
                    {plan.description}
                  </Text>
                )}

                <Button
                  size="small"
                  variant={hasDiscount ? "primary" : "secondary"}
                  type="button"
                  onClick={() => handleSelect(plan)}
                  isLoading={busy}
                  disabled={!!selectingId}
                >
                  {isFree ? "Start free" : "Choose & pay"}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
