import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { useDeals, useParticipate, isSafeDeal, type Deal } from "../../../hooks/api/investments"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const ParticipateForm = ({ deal }: { deal: Deal }) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm({ defaultValues: { amount: "" } })
  const ccy = deal.cap_table?.currency_code
  const isSafe = isSafeDeal(deal)
  const { mutateAsync, isPending } = useParticipate(deal.id, {
    onSuccess: () => {
      toast.success(
        isSafe
          ? "SAFE commitment submitted — awaiting approval"
          : "Participation submitted — awaiting approval"
      )
      handleSuccess()
    },
    onError: (e: any) => toast.error(e?.message || "Failed to participate"),
  })
  const onSubmit = form.handleSubmit(async (v) => {
    const amount = Number(v.amount)
    if (!amount || amount <= 0) {
      toast.error("Enter an amount")
      return
    }
    return mutateAsync({ amount })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" type="submit" isLoading={isPending}>Submit</Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-md flex-col gap-y-6">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">
              {isSafe ? "Invest via SAFE" : "Participate"} in {deal.name}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {deal.cap_table?.name}
              {!isSafe && deal.price_per_share
                ? ` · ${money(deal.price_per_share, ccy)} / share`
                : ""}
            </Text>
          </div>

          {isSafe && (
            <div className="rounded-lg border bg-ui-bg-subtle p-4">
              <Text size="small" weight="plus" className="mb-2">
                SAFE terms {deal.safe_type === "pre_money" ? "(pre-money)" : "(post-money)"}
              </Text>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <Text size="small" className="text-ui-fg-subtle">Valuation cap</Text>
                <Text size="small">{money(deal.valuation_cap, ccy)}</Text>
                <Text size="small" className="text-ui-fg-subtle">Discount</Text>
                <Text size="small">
                  {deal.discount_rate ? `${(Number(deal.discount_rate) * 100).toFixed(0)}%` : "—"}
                </Text>
              </div>
              <Text size="xsmall" className="text-ui-fg-muted mt-2">
                No shares are issued now — your SAFE converts to equity at the next
                priced round or a liquidity event.
              </Text>
            </div>
          )}

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              {isSafe ? "Investment amount" : "Amount"} {ccy ? `(${ccy})` : ""}
            </Label>
            <Input type="number" placeholder="50000" {...form.register("amount", { required: true })} />
            <Text size="small" className="text-ui-fg-subtle">
              We'll confirm your {isSafe ? "SAFE" : "allocation"} and send a payment link.
            </Text>
          </div>
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

export const ParticipateRoute = () => {
  const { dealId } = useParams()
  const { deals, isPending } = useDeals()
  const deal = deals.find((d) => d.id === dealId)

  return (
    <RouteFocusModal>
      {isPending ? (
        <RouteFocusModal.Body className="flex items-center justify-center py-16">
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        </RouteFocusModal.Body>
      ) : !deal ? (
        <RouteFocusModal.Body className="flex items-center justify-center py-16">
          <Text size="small" className="text-ui-fg-subtle">Deal not found.</Text>
        </RouteFocusModal.Body>
      ) : (
        <ParticipateForm deal={deal} />
      )}
    </RouteFocusModal>
  )
}
