import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { Combobox } from "../../../components/inputs/combobox"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { useDeals, useParticipate, isSafeDeal, type Deal } from "../../../hooks/api/investments"
import { useIsViewOnly } from "../../../hooks/api/companies"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const ParticipateForm = ({
  deals,
  initialDealId,
}: {
  deals: Deal[]
  initialDealId?: string
}) => {
  const { handleSuccess } = useRouteModal()
  const isViewOnly = useIsViewOnly()
  const form = useForm({ defaultValues: { amount: "" } })
  // The deal can be preselected from the route (deep link from a deals table)
  // or picked in-drawer via the Combobox below.
  const [selectedId, setSelectedId] = useState<string>(
    deals.some((d) => d.id === initialDealId) ? initialDealId! : ""
  )
  const deal = deals.find((d) => d.id === selectedId)
  const ccy = deal?.cap_table?.currency_code
  const isSafe = deal ? isSafeDeal(deal) : false
  // Keyed by the currently-selected deal; the mutationFn reads the latest id.
  const { mutateAsync, isPending } = useParticipate(selectedId, {
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
    if (isViewOnly) {
      toast.error("Your account is view-only and can't participate in deals")
      return
    }
    if (!selectedId) {
      toast.error("Select a deal to participate in")
      return
    }
    const amount = Number(v.amount)
    if (!amount || amount <= 0) {
      toast.error("Enter an amount")
      return
    }
    return mutateAsync({ amount })
  })

  const dealOptions = deals.map((d) => ({
    value: d.id,
    label: d.cap_table?.name ? `${d.name} — ${d.cap_table.name}` : d.name,
  }))

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!deal || isViewOnly}>Submit</Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-md flex-col gap-y-6">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">
              {isSafe ? "Invest via SAFE" : "Participate"}
              {deal ? ` in ${deal.name}` : ""}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {deal
                ? `${deal.cap_table?.name ?? ""}${
                    !isSafe && deal.price_per_share
                      ? ` · ${money(deal.price_per_share, ccy)} / share`
                      : ""
                  }`
                : "Choose a deal to participate in."}
            </Text>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Deal</Label>
            <Combobox
              options={dealOptions}
              value={selectedId}
              onChange={(v) => setSelectedId((v as string) || "")}
              placeholder="Select a deal…"
            />
          </div>

          {isSafe && deal && (
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

          {deal && (
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                {isSafe ? "Investment amount" : "Amount"} {ccy ? `(${ccy})` : ""}
              </Label>
              <Input type="number" placeholder="50000" {...form.register("amount", { required: true })} />
              <Text size="small" className="text-ui-fg-subtle">
                We'll confirm your {isSafe ? "SAFE" : "allocation"} and send a payment link.
              </Text>
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

export const ParticipateRoute = () => {
  // `dealId` is optional — a deep link preselects it; otherwise the investor
  // picks a deal from the in-drawer Combobox.
  const { dealId } = useParams()
  const { deals, isPending } = useDeals()

  return (
    <RouteFocusModal>
      {isPending ? (
        <RouteFocusModal.Body className="flex items-center justify-center py-16">
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        </RouteFocusModal.Body>
      ) : deals.length === 0 ? (
        <RouteFocusModal.Body className="flex items-center justify-center py-16">
          <Text size="small" className="text-ui-fg-subtle">No open deals available.</Text>
        </RouteFocusModal.Body>
      ) : (
        <ParticipateForm deals={deals} initialDealId={dealId} />
      )}
    </RouteFocusModal>
  )
}
