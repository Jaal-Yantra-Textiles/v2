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
import { CurrencyDollar, DocumentText, Plus, RocketLaunch, Users } from "@medusajs/icons"
import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ActionMenu } from "../common/action-menu"
import { OwnershipDonut, type DonutSegment } from "./ownership-donut"
import {
  useCompanyCapTables,
  usePublishRound,
  type AdminCapTable,
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
      return "red"
    default:
      return "grey"
  }
}

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

  const { segments, totalCommitted, totalPaid } = useMemo(() => {
    const paidStatuses = new Set(["fully_paid", "active", "partially_paid"])
    const segs: DonutSegment[] = stakes.map((s) => ({
      label: s.investor?.name ?? "Investor",
      value: stakeValue(s),
      highlight: s.status === "fully_paid",
    }))
    const committed = stakes.reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    const paid = stakes
      .filter((s) => paidStatuses.has(s.status ?? ""))
      .reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    return { segments: segs, totalCommitted: committed, totalPaid: paid }
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
          <Text size="small" className="text-ui-fg-subtle">Investors</Text>
          <Text weight="plus" className="mt-1">{stakes.length}</Text>
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
        cell: ({ row }: any) => row.original.round_type ?? "—",
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
        </>
      )}
    </Container>
  )
}
