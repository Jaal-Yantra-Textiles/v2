import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Skeleton,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import {
  useDeals,
  useMyParticipations,
  useParticipate,
  type Deal,
  type Participation,
} from "../../hooks/api/investments"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const statusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "fully_paid":
      return "green"
    case "unpaid":
    case "partially_paid":
      return "orange"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

const ParticipateModal = ({ deal }: { deal: Deal }) => {
  const [open, setOpen] = useState(false)
  const form = useForm({ defaultValues: { amount: "" } })
  const ccy = deal.cap_table?.currency_code
  const { mutateAsync, isPending } = useParticipate(deal.id, {
    onSuccess: () => {
      toast.success("Participation submitted — awaiting approval")
      form.reset()
      setOpen(false)
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
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="primary">Participate</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>Submit</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-y-6">
            <div className="flex flex-col gap-y-1">
              <Heading level="h2">Participate in {deal.name}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {deal.cap_table?.name}
                {deal.price_per_share
                  ? ` · ${money(deal.price_per_share, ccy)} / share`
                  : ""}
              </Text>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Amount {ccy ? `(${ccy})` : ""}</Label>
              <Input type="number" placeholder="50000" {...form.register("amount", { required: true })} />
              <Text size="small" className="text-ui-fg-subtle">
                We'll confirm your allocation and send a payment link.
              </Text>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const DealsCard = () => {
  const { deals, isPending } = useDeals()
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Open deals</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Live rounds from the companies you're following.
        </Text>
      </div>
      <div className="px-6 py-5">
        {isPending ? (
          <div className="flex flex-col gap-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : deals.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">No open deals right now.</Text>
        ) : (
          <div className="flex flex-col gap-y-3">
            {deals.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex flex-col gap-y-0.5">
                  <div className="flex items-center gap-x-2">
                    <Text weight="plus">{d.name}</Text>
                    <Badge size="2xsmall">{d.round_type ?? "round"}</Badge>
                  </div>
                  <Text size="small" className="text-ui-fg-subtle">
                    {d.cap_table?.name ?? "—"} · Target{" "}
                    {money(d.target_amount, d.cap_table?.currency_code)}
                  </Text>
                </div>
                <ParticipateModal deal={d} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

const payLink = (p: Participation): string | undefined =>
  p.payments?.find((pm) => pm.metadata?.payu_payment_link)?.metadata
    ?.payu_payment_link as string | undefined

const MyParticipationsCard = () => {
  const { participations, isPending } = useMyParticipations()
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">My participations</Heading>
      </div>
      <div className="px-6 py-5">
        {isPending ? (
          <div className="flex flex-col gap-y-2">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : participations.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            You haven't participated in any deals yet.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Deal</Table.HeaderCell>
                <Table.HeaderCell>Company</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Payment</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {participations.map((p) => {
                const link = payLink(p)
                return (
                  <Table.Row key={p.id}>
                    <Table.Cell>{p.funding_round?.name ?? "—"}</Table.Cell>
                    <Table.Cell>{p.cap_table?.name ?? "—"}</Table.Cell>
                    <Table.Cell>{money(p.total_invested)}</Table.Cell>
                    <Table.Cell>
                      <Badge color={statusColor(p.status)}>{p.status ?? "unpaid"}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {p.status === "fully_paid" ? (
                        <Text size="small" className="text-ui-fg-subtle">Paid</Text>
                      ) : link ? (
                        <a href={link} target="_blank" rel="noreferrer">
                          <Button size="small" variant="secondary">Pay now</Button>
                        </a>
                      ) : (
                        <Text size="small" className="text-ui-fg-subtle">Awaiting approval</Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export const Finances = () => {
  return (
    <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
      <DealsCard />
      <MyParticipationsCard />
    </div>
  )
}
