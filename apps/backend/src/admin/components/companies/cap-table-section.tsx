import {
  Badge,
  Button,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { ArrowPath, CurrencyDollar, DocumentText, PencilSquare, Plus, RocketLaunch, Users } from "@medusajs/icons"
import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ActionMenu } from "../common/action-menu"
import { OwnershipDonut, type DonutSegment } from "./ownership-donut"
import {
  useCompanyCapTables,
  useCapTableConvertibles,
  useApproveConvertible,
  usePublishRound,
  type AdminCapTable,
  type AdminConvertible,
  type AdminFundingRound,
  type AdminStake,
} from "../../hooks/api/cap-tables-admin"

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const stakeValue = (s: AdminStake) =>
  Number(s.total_invested ?? 0) || Number(s.number_of_shares ?? 0) || 0

const stakeStatusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "fully_paid":
    case "active":
      return "green"
    case "partially_paid":
    case "unpaid":
      return "orange"
    case "cancelled":
    case "rejected":
      return "red"
    case "not_followed_up":
      return "grey"
    default:
      return "grey"
  }
}

// A participation is "absorbed" into the capital table only once it's fully
// paid. Committed money and share count exclude parked/declined stakes.
const ABSORBED_STATUSES = new Set(["fully_paid"])
const EXCLUDED_STATUSES = new Set(["rejected", "not_followed_up", "cancelled"])

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

// ---- Ownership (chart + tiles) --------------------------------------------

const OwnershipPanel = ({ capTable }: { capTable: AdminCapTable }) => {
  const stakes = capTable.stakes ?? []
  const ccy = capTable.currency_code

  const { segments, totalCommitted, totalPaid, absorbedCount } = useMemo(() => {
    // Capital table = fully absorbed (paid) stakes only. The ownership donut
    // reflects who actually holds paid-up equity, not who merely committed.
    const absorbed = stakes.filter((s) => ABSORBED_STATUSES.has(s.status ?? ""))
    const segs: DonutSegment[] = absorbed.map((s) => ({
      label: s.investor?.name ?? "Investor",
      value: stakeValue(s),
      highlight: true,
    }))
    // Committed = still-live pipeline (excludes declined / not-followed-up /
    // cancelled), so it reads as "money we expect to raise".
    const committed = stakes
      .filter((s) => !EXCLUDED_STATUSES.has(s.status ?? ""))
      .reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    const paid = absorbed.reduce(
      (sum, s) => sum + Number(s.total_invested ?? 0),
      0
    )
    return {
      segments: segs,
      totalCommitted: committed,
      totalPaid: paid,
      absorbedCount: absorbed.length,
    }
  }, [stakes])

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="rounded-lg border p-4">
        <Text weight="plus" className="mb-3">Ownership</Text>
        <OwnershipDonut
          segments={segments}
          centerLabel="Raised"
          centerValue={money(totalPaid, ccy)}
        />
      </div>
      <div className="grid grid-cols-2 content-start gap-4">
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Committed</Text>
          <Text weight="plus" className="mt-1">{money(totalCommitted, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Raised (paid)</Text>
          <Text weight="plus" className="mt-1">{money(totalPaid, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Authorized</Text>
          <Text weight="plus" className="mt-1">{num(capTable.total_shares_authorized)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Holders (paid)</Text>
          <Text weight="plus" className="mt-1">{absorbedCount}</Text>
        </div>
      </div>
    </div>
  )
}

// ---- Tables (full width) ---------------------------------------------------

const StakesTable = ({ capTable }: { capTable: AdminCapTable }) => {
  const ccy = capTable.currency_code
  const table = useDataTable({
    data: capTable.stakes ?? [],
    columns: [
      {
        header: "Investor",
        accessorKey: "investor",
        cell: ({ row }: any) => row.original.investor?.name ?? row.original.investor_id ?? "—",
      },
      {
        header: "Round",
        accessorKey: "funding_round",
        cell: ({ row }: any) => row.original.funding_round?.name ?? "—",
      },
      {
        header: "Invested",
        accessorKey: "total_invested",
        cell: ({ row }: any) => money(row.original.total_invested, ccy),
      },
      {
        header: "Shares",
        accessorKey: "number_of_shares",
        cell: ({ row }: any) => num(row.original.number_of_shares),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={stakeStatusColor(row.original.status)}>
            {row.original.status ?? "unpaid"}
          </Badge>
        ),
      },
    ],
  })
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

const ShareClassesTable = ({ capTable }: { capTable: AdminCapTable }) => {
  const table = useDataTable({
    data: capTable.share_classes ?? [],
    columns: [
      { header: "Name", accessorKey: "name" },
      {
        header: "Type",
        accessorKey: "class_type",
        cell: ({ row }: any) => <Badge>{row.original.class_type ?? "common"}</Badge>,
      },
      {
        header: "Authorized",
        accessorKey: "authorized_shares",
        cell: ({ row }: any) => num(row.original.authorized_shares),
      },
    ],
  })
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

const DealActions = ({
  capTableId,
  round,
}: {
  capTableId: string
  round: AdminFundingRound
}) => {
  const { mutate: publish } = usePublishRound(capTableId, {
    onSuccess: () => toast.success("Round published — investors can now participate"),
    onError: (e) => toast.error(e?.message || "Publish failed"),
  })
  const canPublish =
    round.status !== "open" && round.status !== "closed" && round.status !== "cancelled"
  return (
    <div className="flex justify-end">
      <ActionMenu
        groups={[
          {
            actions: [
              {
                icon: <RocketLaunch />,
                label: "Publish round",
                disabled: !canPublish,
                onClick: () => publish(round.id),
              },
              {
                icon: <PencilSquare />,
                label: "Edit target amount",
                // Locked once a participant onboards (server enforces too).
                disabled:
                  round.status === "closed" || round.status === "cancelled",
                to: `edit-round-target?round_id=${round.id}`,
              },
              {
                icon: <CurrencyDollar />,
                label: "View participations",
                to: `participations?round_id=${round.id}`,
              },
            ],
          },
        ]}
      />
    </div>
  )
}

const FundingRoundsTable = ({ capTable }: { capTable: AdminCapTable }) => {
  const table = useDataTable({
    data: capTable.funding_rounds ?? [],
    columns: [
      { header: "Name", accessorKey: "name" },
      {
        header: "Type",
        accessorKey: "round_type",
        cell: ({ row }: any) => {
          const it = row.original.instrument_type
          if (it === "ccps" || row.original.round_type === "ccps") {
            return <Badge size="2xsmall" color="blue">CCPS</Badge>
          }
          const isSafe =
            it === "safe" ||
            it === "convertible_note" ||
            row.original.round_type === "safe"
          return isSafe ? (
            <Badge size="2xsmall" color="purple">SAFE</Badge>
          ) : (
            row.original.round_type ?? "—"
          )
        },
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={roundStatusColor(row.original.status)}>
            {row.original.status ?? "planned"}
          </Badge>
        ),
      },
      {
        header: "Target",
        accessorKey: "target_amount",
        cell: ({ row }: any) => num(row.original.target_amount),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => (
          <DealActions capTableId={capTable.id} round={row.original} />
        ),
      },
    ],
  })
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

const pct = (v?: number | null) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(2)}%`

const convertibleStatusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "outstanding":
      return "green"
    case "converted":
      return "grey"
    case "redeemed":
      return "orange"
    case "cancelled":
    case "expired":
      return "red"
    default:
      return "grey"
  }
}

// A convertible has no `fully_paid` instrument state — settlement lives on its
// payment. Only count it as paid once a payment is `completed`; an approved-but-
// unpaid convertible is surfaced as "Awaiting payment", not silently invested.
const convertibleIsPaid = (c: AdminConvertible) =>
  !!c.payments?.some((pm) => pm.status === "completed")

const ConvertiblesTable = ({ capTable }: { capTable: AdminCapTable }) => {
  const ccy = capTable.currency_code
  const { convertibles = [], isPending } = useCapTableConvertibles(capTable.id)
  const { mutate: approve } = useApproveConvertible(capTable.id, {
    onSuccess: (r) =>
      toast.success(
        r?.payment_link ? "Approved — PayU link generated" : "Approved — pending payment"
      ),
    onError: (e) => toast.error(e?.message || "Approve failed"),
  })

  const table = useDataTable({
    data: convertibles,
    columns: [
      {
        header: "Investor",
        accessorKey: "investor",
        cell: ({ row }: any) => row.original.investor?.name ?? row.original.investor_id ?? "—",
      },
      {
        header: "Instrument",
        accessorKey: "instrument_type",
        cell: ({ row }: any) => {
          const it = row.original.instrument_type
          if (it === "ccps") return <Badge size="2xsmall" color="blue">CCPS</Badge>
          return (
            <Badge size="2xsmall" color="purple">
              {it === "convertible_note" ? "Loan" : "SAFE"}
            </Badge>
          )
        },
      },
      {
        header: "Principal",
        accessorKey: "principal_amount",
        cell: ({ row }: any) => money(row.original.value?.principal ?? row.original.principal_amount, ccy),
      },
      {
        header: "Cap",
        accessorKey: "valuation_cap",
        cell: ({ row }: any) => money(row.original.valuation_cap, ccy),
      },
      {
        header: "Implied own.",
        id: "implied_own",
        cell: ({ row }: any) => pct(row.original.value?.implied_ownership_pct),
      },
      {
        header: "Implied value",
        id: "implied_value",
        cell: ({ row }: any) => money(row.original.value?.implied_value, ccy),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => {
          const c = row.original as AdminConvertible
          const status = c.status ?? "outstanding"
          const showPayment = status === "outstanding" && !convertibleIsPaid(c)
          return (
            <div className="flex items-center gap-x-1">
              <Badge color={convertibleStatusColor(status)}>{status}</Badge>
              {showPayment && (
                <Badge size="2xsmall" color="orange">
                  Awaiting payment
                </Badge>
              )}
            </div>
          )
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const c = row.original as AdminConvertible
          const approved = !!c.metadata?.approved
          const isOutstanding = (c.status ?? "outstanding") === "outstanding"
          return (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <CurrencyDollar />,
                        label: "Approve (generate pay link)",
                        disabled: approved,
                        onClick: () => approve(c.id),
                      },
                      {
                        icon: <ArrowPath />,
                        label:
                          c.instrument_type === "convertible_note"
                            ? "Convert (loan → CCPS/equity)"
                            : "Convert to equity/CCPS",
                        disabled: !isOutstanding,
                        to: `convert-convertible?convertible_id=${c.id}`,
                      },
                    ],
                  },
                ]}
              />
            </div>
          )
        },
      },
    ],
  })

  if (isPending) return <Skeleton className="mx-6 mb-5 h-16" />
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

// ---- Section ---------------------------------------------------------------

const FullWidthBlock = ({
  title,
  empty,
  showTable,
  children,
}: {
  title: string
  empty: string
  showTable: boolean
  children: React.ReactNode
}) => (
  <div>
    <div className="px-6 pb-3 pt-5">
      <Text weight="plus">{title}</Text>
    </div>
    {showTable ? (
      children
    ) : (
      <div className="px-6 pb-5">
        <Text size="small" className="text-ui-fg-subtle">{empty}</Text>
      </div>
    )}
  </div>
)

export const CapTableSection = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [], isPending } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Cap table</Heading>
        {!isPending &&
          (capTable ? (
            <ActionMenu
              groups={[
                {
                  actions: [
                    { icon: <Users />, label: "Provision shares (manual)", to: "provision-stake" },
                    { icon: <DocumentText />, label: "Record SAFE (manual)", to: "add-safe" },
                    { icon: <Plus />, label: "Add share class", to: "add-share-class" },
                    { icon: <Plus />, label: "Add funding round", to: "add-round" },
                    { icon: <DocumentText />, label: "Add document", to: "add-document" },
                  ],
                },
              ]}
            />
          ) : (
            <Button size="small" variant="primary" asChild>
              <Link to="create-cap-table">Create cap table</Link>
            </Button>
          ))}
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
        <>
          <div className="px-6 py-5">
            <OwnershipPanel capTable={capTable} />
          </div>
          <FullWidthBlock
            title="Stakes"
            empty="No stakes yet."
            showTable={!!capTable.stakes?.length}
          >
            <StakesTable capTable={capTable} />
          </FullWidthBlock>
          <FullWidthBlock
            title="Share classes"
            empty="No share classes yet."
            showTable={!!capTable.share_classes?.length}
          >
            <ShareClassesTable capTable={capTable} />
          </FullWidthBlock>
          <FullWidthBlock
            title="Funding rounds (deals)"
            empty="No rounds yet."
            showTable={!!capTable.funding_rounds?.length}
          >
            <FundingRoundsTable capTable={capTable} />
          </FullWidthBlock>
          <div>
            <div className="px-6 pb-3 pt-5">
              <Text weight="plus">SAFEs &amp; convertibles</Text>
            </div>
            <ConvertiblesTable capTable={capTable} />
          </div>
        </>
      )}
    </Container>
  )
}
