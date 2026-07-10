import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { useDeals, useParticipate, type Deal } from "../../../hooks/api/investments"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const ParticipateForm = ({ deal }: { deal: Deal }) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm({ defaultValues: { amount: "" } })
  const ccy = deal.cap_table?.currency_code
  const { mutateAsync, isPending } = useParticipate(deal.id, {
    onSuccess: () => {
      toast.success("Participation submitted — awaiting approval")
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
            <Heading level="h2">Participate in {deal.name}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {deal.cap_table?.name}
              {deal.price_per_share ? ` · ${money(deal.price_per_share, ccy)} / share` : ""}
            </Text>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Amount {ccy ? `(${ccy})` : ""}</Label>
            <Input type="number" placeholder="50000" {...form.register("amount", { required: true })} />
            <Text size="small" className="text-ui-fg-subtle">
              We'll confirm your allocation and send a payment link.
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
