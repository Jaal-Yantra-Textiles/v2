import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import {
  useApproveParticipation,
  useCompanyCapTables,
  useCreateCapTable,
  useCreateFundingRound,
  useCreateShareClass,
  useMarkParticipationPaid,
  usePublishRound,
  useRoundParticipations,
  type AdminCapTable,
  type AdminFundingRound,
} from "../../hooks/api/cap-tables-admin"

const SHARE_CLASS_TYPES = [
  "common",
  "preferred",
  "convertible_note",
  "safe",
  "warrant",
  "option",
] as const

const ROUND_TYPES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "bridge",
  "debt",
  "grant",
] as const

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

// ---- Create cap table ------------------------------------------------------

const CreateCapTableModal = ({ companyId }: { companyId: string }) => {
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: "", currency_code: "USD", total_shares_authorized: "" },
  })
  const { mutateAsync, isPending } = useCreateCapTable(companyId, {
    onSuccess: () => {
      toast.success("Cap table created")
      form.reset()
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to create cap table"),
  })

  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      name: v.name,
      currency_code: v.currency_code || undefined,
      total_shares_authorized: v.total_shares_authorized
        ? Number(v.total_shares_authorized)
        : null,
      status: "active",
    })
  )

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="primary">
          Create cap table
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>
            Create
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">New cap table</Heading>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Name</Label>
              <Input placeholder="Ordinary cap table" {...form.register("name", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Currency (ISO)</Label>
                <Input placeholder="USD" {...form.register("currency_code")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Authorized shares</Label>
                <Input type="number" placeholder="10000000" {...form.register("total_shares_authorized")} />
              </div>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---- Add share class -------------------------------------------------------

const AddShareClassModal = ({ capTableId }: { capTableId: string }) => {
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: "", class_type: "common", authorized_shares: "" },
  })
  const { mutateAsync, isPending } = useCreateShareClass(capTableId, {
    onSuccess: () => {
      toast.success("Share class added")
      form.reset()
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to add share class"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      name: v.name,
      class_type: v.class_type,
      authorized_shares: v.authorized_shares ? Number(v.authorized_shares) : null,
    })
  )
  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Add share class</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>Add</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">New share class</Heading>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Name</Label>
              <Input placeholder="Series A Preferred" {...form.register("name", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Type</Label>
                <Controller
                  control={form.control}
                  name="class_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger><Select.Value /></Select.Trigger>
                      <Select.Content>
                        {SHARE_CLASS_TYPES.map((t) => (
                          <Select.Item key={t} value={t}>{t}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  )}
                />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Authorized shares</Label>
                <Input type="number" {...form.register("authorized_shares")} />
              </div>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---- Add funding round (deal) ---------------------------------------------

const AddFundingRoundModal = ({ capTableId }: { capTableId: string }) => {
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: {
      name: "",
      round_type: "seed",
      target_amount: "",
      pre_money_valuation: "",
      price_per_share: "",
    },
  })
  const { mutateAsync, isPending } = useCreateFundingRound(capTableId, {
    onSuccess: () => {
      toast.success("Funding round created")
      form.reset()
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to create round"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      name: v.name,
      round_type: v.round_type,
      status: "planned",
      target_amount: v.target_amount ? Number(v.target_amount) : null,
      pre_money_valuation: v.pre_money_valuation ? Number(v.pre_money_valuation) : null,
      price_per_share: v.price_per_share ? Number(v.price_per_share) : null,
    })
  )
  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Add round</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>Create</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">New funding round</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              An open round becomes a deal investors can participate in.
            </Text>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Name</Label>
              <Input placeholder="Seed round 2026" {...form.register("name", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Round type</Label>
                <Controller
                  control={form.control}
                  name="round_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger><Select.Value /></Select.Trigger>
                      <Select.Content>
                        {ROUND_TYPES.map((t) => (
                          <Select.Item key={t} value={t}>{t}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  )}
                />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Target amount</Label>
                <Input type="number" {...form.register("target_amount")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Pre-money valuation</Label>
                <Input type="number" {...form.register("pre_money_valuation")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Price / share</Label>
                <Input type="number" {...form.register("price_per_share")} />
              </div>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---- Deal participations (publish / approve / mark paid) -------------------

const ParticipationsModal = ({ round }: { round: AdminFundingRound }) => {
  const [open, setOpen] = useState(false)
  const { participations = [], isPending } = useRoundParticipations(round.id, {
    enabled: open,
  })
  const { mutateAsync: approve } = useApproveParticipation(round.id, {
    onSuccess: (r) => {
      toast.success(
        r?.payment_link
          ? "Approved — PayU link generated"
          : "Approved — pending payment (PayU not configured)"
      )
    },
    onError: (e) => toast.error(e?.message || "Approve failed"),
  })
  const { mutateAsync: markPaid } = useMarkParticipationPaid(round.id, {
    onSuccess: () => toast.success("Marked as paid"),
    onError: (e) => toast.error(e?.message || "Failed"),
  })

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="transparent">Participations</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header />
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <div className="flex w-full max-w-3xl flex-col gap-y-4">
            <Heading level="h2">Participations — {round.name}</Heading>
            {isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : participations.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No participations yet.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Investor</Table.HeaderCell>
                    <Table.HeaderCell>Amount</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                    <Table.HeaderCell>Pay link</Table.HeaderCell>
                    <Table.HeaderCell>Actions</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {participations.map((p) => {
                    const link = p.payments?.find((pm) => pm.metadata?.payu_payment_link)
                      ?.metadata?.payu_payment_link as string | undefined
                    const approved = !!p.metadata?.approved
                    return (
                      <Table.Row key={p.id}>
                        <Table.Cell>{p.investor?.name ?? p.investor_id ?? "—"}</Table.Cell>
                        <Table.Cell>{num(p.total_invested)}</Table.Cell>
                        <Table.Cell><Badge>{p.status ?? "unpaid"}</Badge></Table.Cell>
                        <Table.Cell>
                          {link ? (
                            <a href={link} target="_blank" rel="noreferrer" className="text-ui-fg-interactive">Open</a>
                          ) : "—"}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex gap-x-2">
                            {!approved && (
                              <Button size="small" variant="secondary" onClick={() => approve(p.id)}>
                                Approve
                              </Button>
                            )}
                            {p.status !== "fully_paid" && (
                              <Button size="small" variant="transparent" onClick={() => markPaid(p.id)}>
                                Mark paid
                              </Button>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            )}
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const DealActions = ({
  capTableId,
  round,
}: {
  capTableId: string
  round: AdminFundingRound
}) => {
  const { mutateAsync: publish, isPending } = usePublishRound(capTableId, {
    onSuccess: () => toast.success("Round published — investors can now participate"),
    onError: (e) => toast.error(e?.message || "Publish failed"),
  })
  const canPublish = round.status !== "open" && round.status !== "closed" && round.status !== "cancelled"
  return (
    <div className="flex justify-end gap-x-2">
      {canPublish && (
        <Button size="small" variant="secondary" isLoading={isPending} onClick={() => publish(round.id)}>
          Publish
        </Button>
      )}
      <ParticipationsModal round={round} />
    </div>
  )
}

// ---- Section ---------------------------------------------------------------

const roundStatusColor = (status?: string): "green" | "orange" | "grey" | "red" => {
  switch (status) {
    case "open":
      return "green"
    case "closing":
    case "planned":
      return "orange"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

const CapTableBody = ({ capTable }: { capTable: AdminCapTable }) => (
  <div className="flex flex-col gap-y-6 px-6 py-5">
    {/* Totals */}
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {[
        ["Authorized", capTable.total_shares_authorized],
        ["Issued", capTable.total_shares_issued],
        ["Outstanding", capTable.total_shares_outstanding],
        ["Fully diluted", capTable.fully_diluted_shares],
      ].map(([label, v]) => (
        <div key={label as string} className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">{label as string}</Text>
          <Text weight="plus" className="mt-1">{num(v as number | null)}</Text>
        </div>
      ))}
    </div>

    {/* Share classes */}
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <Text weight="plus">Share classes</Text>
        <AddShareClassModal capTableId={capTable.id} />
      </div>
      {capTable.share_classes?.length ? (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Authorized</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {capTable.share_classes.map((sc) => (
              <Table.Row key={sc.id}>
                <Table.Cell>{sc.name}</Table.Cell>
                <Table.Cell><Badge>{sc.class_type ?? "common"}</Badge></Table.Cell>
                <Table.Cell>{num(sc.authorized_shares)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <Text size="small" className="text-ui-fg-subtle">No share classes yet.</Text>
      )}
    </div>

    {/* Funding rounds / deals */}
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <Text weight="plus">Funding rounds (deals)</Text>
        <AddFundingRoundModal capTableId={capTable.id} />
      </div>
      {capTable.funding_rounds?.length ? (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Target</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Deal</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {capTable.funding_rounds.map((fr) => (
              <Table.Row key={fr.id}>
                <Table.Cell>{fr.name}</Table.Cell>
                <Table.Cell>{fr.round_type ?? "—"}</Table.Cell>
                <Table.Cell>
                  <Badge color={roundStatusColor(fr.status)}>{fr.status ?? "planned"}</Badge>
                </Table.Cell>
                <Table.Cell>{num(fr.target_amount)}</Table.Cell>
                <Table.Cell>
                  <DealActions capTableId={capTable.id} round={fr} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <Text size="small" className="text-ui-fg-subtle">No rounds yet.</Text>
      )}
    </div>
  </div>
)

export const CapTableSection = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [], isPending } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Cap table</Heading>
        {!isPending && !capTable && <CreateCapTableModal companyId={companyId} />}
      </div>
      {isPending ? (
        <div className="flex flex-col gap-y-2 px-6 py-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : !capTable ? (
        <div className="px-6 py-8 text-center">
          <Text size="small" className="text-ui-fg-subtle">
            No cap table yet. Create one to add share classes and funding rounds.
          </Text>
        </div>
      ) : (
        <CapTableBody capTable={capTable} />
      )}
    </Container>
  )
}
