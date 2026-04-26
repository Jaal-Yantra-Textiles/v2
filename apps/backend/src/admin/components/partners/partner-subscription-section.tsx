import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  toast,
  usePrompt,
  Skeleton,
} from "@medusajs/ui"
import { Plus, XCircle } from "@medusajs/icons"
import {
  usePartnerSubscriptions,
  useAdminAssignSubscription,
  useAdminCancelSubscription,
  AdminPartnerSubscription,
  AdminPartnerPlan,
} from "../../hooks/api/partners-admin"

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

const statusColor = (status: string): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "active": return "green"
    case "past_due": return "orange"
    case "canceled": case "expired": return "red"
    default: return "grey"
  }
}

export const PartnerSubscriptionSection = ({ partnerId }: { partnerId: string }) => {
  const { subscriptions, plans, isPending } = usePartnerSubscriptions(partnerId)
  const prompt = usePrompt()
  const [showAssign, setShowAssign] = useState(false)

  const { mutateAsync: assign, isPending: isAssigning } = useAdminAssignSubscription(partnerId)
  const { mutateAsync: cancel, isPending: isCanceling } = useAdminCancelSubscription(partnerId)

  const activeSub = subscriptions.find((s) => s.status === "active")

  const handleAssign = async (plan: AdminPartnerPlan) => {
    const confirmed = await prompt({
      title: `Assign ${plan.name} Plan`,
      description:
        plan.price > 0
          ? `This will assign the ${plan.name} plan (${formatPrice(plan.price, plan.currency_code)}/${plan.interval}) without requiring payment. Use this for comps, trials, or manual billing.`
          : `This will assign the free ${plan.name} plan to the partner.`,
      confirmText: "Assign Plan",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    try {
      await assign({ plan_id: plan.id, skip_payment: true, notes: "Admin assigned" })
      toast.success(`${plan.name} plan assigned`)
      setShowAssign(false)
    } catch (e: any) {
      toast.error(e?.message || "Failed to assign plan")
    }
  }

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel Subscription",
      description: "This will cancel the partner's active subscription immediately.",
      confirmText: "Cancel Subscription",
      cancelText: "Go Back",
    })
    if (!confirmed) return

    try {
      await cancel()
      toast.success("Subscription canceled")
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel")
    }
  }

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Subscription</Heading>
        </div>
        <div className="px-6 py-4">
          <Skeleton className="h-16" />
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Subscription</Heading>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setShowAssign(!showAssign)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Assign Plan
        </Button>
      </div>

      {/* Active subscription */}
      {activeSub ? (
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Text weight="plus">{(activeSub.plan as any)?.name || "Unknown"}</Text>
              <Badge size="2xsmall" color={statusColor(activeSub.status)}>
                {activeSub.status}
              </Badge>
              <Badge size="2xsmall" color="grey">
                {activeSub.payment_provider}
              </Badge>
            </div>
            <Button
              variant="danger"
              size="small"
              onClick={handleCancel}
              isLoading={isCanceling}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            <Text size="xsmall" className="text-ui-fg-subtle">Price</Text>
            <Text size="xsmall">
              {activeSub.plan
                ? formatPrice((activeSub.plan as any).price, (activeSub.plan as any).currency_code)
                : "-"}
              {(activeSub.plan as any)?.price > 0 && `/${(activeSub.plan as any)?.interval}`}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">Period</Text>
            <Text size="xsmall">
              {formatDate(activeSub.current_period_start)} — {formatDate(activeSub.current_period_end)}
            </Text>
          </div>
        </div>
      ) : (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">No active subscription</Text>
        </div>
      )}

      {/* Assign plan selector */}
      {showAssign && (
        <div className="px-6 py-4 bg-ui-bg-subtle">
          <Text size="small" weight="plus" className="mb-2">Select a plan to assign:</Text>
          <div className="space-y-2">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex items-center justify-between p-3 rounded border border-ui-border-base bg-ui-bg-base"
              >
                <div>
                  <Text size="small" weight="plus">{plan.name}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {formatPrice(plan.price, plan.currency_code)}
                    {plan.price > 0 && `/${plan.interval}`}
                  </Text>
                </div>
                <Button
                  size="small"
                  onClick={() => handleAssign(plan)}
                  isLoading={isAssigning}
                  disabled={activeSub?.plan?.id === plan.id}
                >
                  {activeSub?.plan?.id === plan.id ? "Current" : "Assign"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription history */}
      {subscriptions.length > 1 && (
        <>
          <div className="px-6 py-3 bg-ui-bg-subtle">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">History</Text>
          </div>
          {subscriptions
            .filter((s) => s.id !== activeSub?.id)
            .slice(0, 5)
            .map((sub) => (
              <div key={sub.id} className="px-6 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Text size="xsmall">{(sub.plan as any)?.name || "?"}</Text>
                  <Badge size="2xsmall" color={statusColor(sub.status)}>{sub.status}</Badge>
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {formatDate(sub.created_at)}
                  {sub.canceled_at && ` → ${formatDate(sub.canceled_at)}`}
                </Text>
              </div>
            ))}
        </>
      )}
    </Container>
  )
}
