import { CheckCircleSolid, ExclamationCircleSolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import {
  useStripeConnectStatus,
  useStartStripeConnect,
} from "../../../../hooks/api/payment-config"

/**
 * "Get onboarded faster with JYT Stripe Connect" card, shown above the manual
 * payment-provider list. Handles three states: not connected, onboarding in
 * progress (resume), and active. When active, Connect is the authoritative
 * Stripe source and manual keys become a fallback.
 */
export const StripeConnectCard = () => {
  const { t } = useTranslation()
  const { stripe_connect, isPending, refetch } = useStripeConnectStatus()
  const { mutateAsync: startConnect, isPending: isStarting } =
    useStartStripeConnect()

  // Re-sync when Stripe redirects the partner back (?stripe_connect=return).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("stripe_connect") === "return") {
      refetch()
      params.delete("stripe_connect")
      const qs = params.toString()
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "")
      )
    }
  }, [refetch])

  const handleStart = async () => {
    // Return the partner to this settings page; Stripe appends its own params.
    const base = window.location.origin + window.location.pathname
    const returnUrl = `${base}?stripe_connect=return`
    await startConnect(
      { return_url: returnUrl, refresh_url: returnUrl },
      {
        onSuccess: ({ url }) => {
          window.location.href = url
        },
        onError: (e) =>
          toast.error(e.message || t("partner.stripeConnect.toast.startFailed")),
      }
    )
  }

  // India (PayU/INR) and non-EUR partners aren't on the Stripe Connect rail —
  // don't render the card at all for them. While the status is still loading
  // (stripe_connect undefined) we also render nothing to avoid a flash.
  if (!stripe_connect?.eligible) {
    return null
  }

  const status = stripe_connect?.status
  const isActive = status === "active" && stripe_connect?.charges_enabled
  const isOnboarding =
    stripe_connect?.connected && !isActive && status !== "disconnected"

  return (
    <Container className="flex flex-col gap-y-4 px-6 py-6">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <Heading level="h2">
              {t("partner.stripeConnect.heading", "JYT Stripe Connect")}
            </Heading>
            {isActive && (
              <Badge color="green" size="2xsmall" className="flex items-center gap-x-1">
                <CheckCircleSolid className="text-ui-fg-on-color" />
                {t("partner.stripeConnect.badge.active", "Active")}
              </Badge>
            )}
            {isOnboarding && (
              <Badge color="orange" size="2xsmall" className="flex items-center gap-x-1">
                <ExclamationCircleSolid />
                {t("partner.stripeConnect.badge.pending", "Setup incomplete")}
              </Badge>
            )}
          </div>
          <Text size="small" className="text-ui-fg-subtle max-w-[560px]">
            {isActive
              ? t(
                  "partner.stripeConnect.description.active",
                  "Payments run through JYT's Stripe Connect. This is your live Stripe source — any manually entered keys below are used only as a fallback."
                )
              : t(
                  "partner.stripeConnect.description.default",
                  "Skip entering API keys. Connect a Stripe account through JYT to get paid faster, with payouts and refunds handled for you."
                )}
          </Text>
          {isActive && stripe_connect?.account_id && (
            <Text size="xsmall" className="text-ui-fg-muted font-mono mt-1">
              {stripe_connect.account_id}
              {!stripe_connect.payouts_enabled &&
                ` · ${t("partner.stripeConnect.payoutsPending", "payouts pending")}`}
            </Text>
          )}
        </div>

        <div className="shrink-0">
          {isActive ? (
            <Button
              size="small"
              variant="secondary"
              isLoading={isStarting}
              onClick={handleStart}
            >
              {t("partner.stripeConnect.actions.manage", "Update details")}
            </Button>
          ) : (
            <Button
              size="small"
              variant="primary"
              isLoading={isPending || isStarting}
              onClick={handleStart}
            >
              {isOnboarding
                ? t("partner.stripeConnect.actions.resume", "Finish setup")
                : t("partner.stripeConnect.actions.connect", "Connect with Stripe")}
            </Button>
          )}
        </div>
      </div>
    </Container>
  )
}
