import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { useMemo } from "react"
import {
  OwnershipDonut,
  type DonutSegment,
} from "../../components/common/ownership-donut"
import {
  useMyCapTable,
  type CapTableStake,
  type InvestorCapTable,
} from "../../hooks/api/investments"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

const stakeValue = (s: CapTableStake) =>
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

const StakesTable = ({
  stakes,
  ccy,
}: {
  stakes: CapTableStake[]
  ccy?: string | null
}) => {
  const table = useDataTable({
    data: stakes,
    columns: [
      {
        header: "Investor",
        accessorKey: "investor",
        cell: ({ row }: any) =>
          row.original.is_me ? (
            <span className="flex items-center gap-x-2">
              {row.original.investor?.name ?? "You"}
              <Badge size="2xsmall" color="blue">You</Badge>
            </span>
          ) : (
            row.original.investor?.name ?? "—"
          ),
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

const CapTableCard = ({ capTable }: { capTable: InvestorCapTable }) => {
  const stakes = capTable.stakes ?? []
  const ccy = capTable.currency_code

  const { segments, myInvested, totalRaised } = useMemo(() => {
    const paid = new Set(["fully_paid", "active", "partially_paid"])
    const segs: DonutSegment[] = stakes.map((s) => ({
      label: s.is_me ? `${s.investor?.name ?? "You"} (You)` : s.investor?.name ?? "Investor",
      value: stakeValue(s),
      highlight: s.is_me,
    }))
    const mine = stakes
      .filter((s) => s.is_me)
      .reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    const raised = stakes
      .filter((s) => paid.has(s.status ?? ""))
      .reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    return { segments: segs, myInvested: mine, totalRaised: raised }
  }, [stakes])

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{capTable.name}</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Ownership overview
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-2">
        <OwnershipDonut
          segments={segments}
          centerLabel="Raised"
          centerValue={money(totalRaised, ccy)}
        />
        <div className="grid grid-cols-2 content-start gap-4">
          <div className="rounded-lg border p-3">
            <Text size="small" className="text-ui-fg-subtle">Your investment</Text>
            <Text weight="plus" className="mt-1">{money(myInvested, ccy)}</Text>
          </div>
          <div className="rounded-lg border p-3">
            <Text size="small" className="text-ui-fg-subtle">Total raised</Text>
            <Text weight="plus" className="mt-1">{money(totalRaised, ccy)}</Text>
          </div>
          <div className="rounded-lg border p-3">
            <Text size="small" className="text-ui-fg-subtle">Post-money</Text>
            <Text weight="plus" className="mt-1">
              {money(capTable.post_money_valuation, ccy)}
            </Text>
          </div>
          <div className="rounded-lg border p-3">
            <Text size="small" className="text-ui-fg-subtle">Authorized shares</Text>
            <Text weight="plus" className="mt-1">{num(capTable.total_shares_authorized)}</Text>
          </div>
        </div>
      </div>

      {stakes.length > 0 && (
        <div className="flex flex-col gap-y-2 px-6 py-5">
          <Text weight="plus">Stakes</Text>
          <StakesTable stakes={stakes} ccy={ccy} />
        </div>
      )}
    </Container>
  )
}

export const Component = () => {
  const { capTables, isPending } = useMyCapTable()

  if (isPending) {
    return (
      <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
        <Container className="p-6">
          <Skeleton className="h-48 w-full" />
        </Container>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
      {capTables.length === 0 ? (
        // Show the chart shell by default even before the investor participates.
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Cap table</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Ownership overview
            </Text>
          </div>
          <div className="px-6 py-8">
            <OwnershipDonut segments={[]} centerLabel="Raised" centerValue="—" />
          </div>
        </Container>
      ) : (
        capTables.map((ct) => <CapTableCard key={ct.id} capTable={ct} />)
      )}
    </div>
  )
}
