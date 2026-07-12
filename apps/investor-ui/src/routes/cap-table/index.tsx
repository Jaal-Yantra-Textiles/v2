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
  useMyConvertibles,
  type CapTableStake,
  type InvestorCapTable,
  type MyConvertible,
  type ConvertibleSummary,
} from "../../hooks/api/investments"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

const pct = (v?: number | null) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(2)}%`

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
    case "rejected":
      return "red"
    case "not_followed_up":
      return "grey"
    default:
      return "grey"
  }
}

// The cap table reflects only fully absorbed (fully_paid) stakes — matches the
// admin. Declined / not-followed-up / cancelled are hidden from the list.
const CAP_EXCLUDED_STATUSES = new Set(["rejected", "not_followed_up", "cancelled"])

const CapTableList = ({ capTables }: { capTables: InvestorCapTable[] }) => {
  const stakes = capTables
    .flatMap((ct) => ct.stakes ?? [])
    .filter((s) => !CAP_EXCLUDED_STATUSES.has(s.status ?? ""))
  const ccy = capTables[0]?.currency_code

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
        header: "Cap Table",
        accessorKey: "cap_table_name",
        cell: ({ row }: any) => {
          const ct = capTables.find((c) => c.id === row.original.cap_table_id)
          return ct?.name ?? "—"
        },
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
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

const CapTableSection = ({
  capTable,
  outstandingPrincipal = 0,
}: {
  capTable: InvestorCapTable
  // Your outstanding convertible/loan/SAFE principal on this cap table — not yet
  // equity, so it's not in "Your investment" but worth nudging so ₹0 isn't scary.
  outstandingPrincipal?: number
}) => {
  const stakes = capTable.stakes ?? []
  const ccy = capTable.currency_code

  const { segments, myInvested, totalRaised } = useMemo(() => {
    // Only fully absorbed (fully_paid) stakes are on the cap table.
    const absorbed = stakes.filter((s) => s.status === "fully_paid")
    const segs: DonutSegment[] = absorbed.map((s) => ({
      label: s.is_me ? `${s.investor?.name ?? "You"} (You)` : s.investor?.name ?? "Investor",
      value: stakeValue(s),
      highlight: s.is_me,
    }))
    const mine = absorbed
      .filter((s) => s.is_me)
      .reduce((sum, s) => sum + Number(s.total_invested ?? 0), 0)
    const raised = absorbed.reduce(
      (sum, s) => sum + Number(s.total_invested ?? 0),
      0
    )
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
            {outstandingPrincipal > 0 && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                + {money(outstandingPrincipal, ccy)} in an outstanding loan/SAFE —
                converts to equity later (see below)
              </Text>
            )}
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
    </Container>
  )
}

const safeStatusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "outstanding":
      return "green"
    case "converted":
      return "blue" as any
    case "redeemed":
      return "orange"
    case "cancelled":
    case "expired":
      return "red"
    default:
      return "grey"
  }
}

// SAFEs / convertibles — kept as a SEPARATE section from common shares because a
// SAFE holder has no shares yet; their value is *implied* (principal, implied
// ownership floor, implied current value against the company valuation).
const SafesSection = ({
  convertibles,
  summary,
}: {
  convertibles: MyConvertible[]
  summary: ConvertibleSummary
}) => {
  const ccy = convertibles[0]?.currency_code ?? convertibles[0]?.cap_table?.currency_code

  const table = useDataTable({
    data: convertibles,
    columns: [
      {
        header: "Instrument",
        accessorKey: "instrument_type",
        cell: ({ row }: any) => {
          const it = row.original.instrument_type
          const label =
            it === "ccps" ? "CCPS" : it === "convertible_note" ? "Loan / note" : "SAFE"
          return (
            <span className="flex items-center gap-x-2">
              {it === "ccps" && (
                <Badge size="2xsmall" color="blue">CCPS</Badge>
              )}
              {label}
              {row.original.safe_type === "pre_money" ? (
                <Badge size="2xsmall" color="grey">pre-money</Badge>
              ) : (
                <Badge size="2xsmall" color="grey">post-money</Badge>
              )}
            </span>
          )
        },
      },
      {
        header: "Shares",
        accessorKey: "num_shares",
        cell: ({ row }: any) =>
          row.original.instrument_type === "ccps"
            ? num(row.original.num_shares)
            : "—",
      },
      {
        header: "Company",
        accessorKey: "cap_table",
        cell: ({ row }: any) => row.original.cap_table?.name ?? "—",
      },
      {
        header: "Principal",
        accessorKey: "principal_amount",
        cell: ({ row }: any) => money(row.original.value?.principal, row.original.currency_code ?? ccy),
      },
      {
        header: "Cap",
        accessorKey: "valuation_cap",
        cell: ({ row }: any) => money(row.original.valuation_cap, row.original.currency_code ?? ccy),
      },
      {
        header: "Implied own.",
        accessorKey: "implied_ownership",
        cell: ({ row }: any) => pct(row.original.value?.implied_ownership_pct),
      },
      {
        header: "Implied value",
        accessorKey: "implied_value",
        cell: ({ row }: any) => money(row.original.value?.implied_value, row.original.currency_code ?? ccy),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={safeStatusColor(row.original.status)}>
            {row.original.status ?? "outstanding"}
          </Badge>
        ),
      },
    ],
  })

  const multiple =
    summary.total_principal > 0
      ? summary.total_implied_value / summary.total_principal
      : null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">SAFEs, Convertibles &amp; CCPS</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Money invested now that converts to equity later. A SAFE/note issues no shares yet; a CCPS allots preference shares up front (with a liquidation-preference floor). Value is implied against the company valuation.
        </Text>
      </div>

      <div className="grid grid-cols-2 gap-4 px-6 py-5 md:grid-cols-4">
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Total invested</Text>
          <Text weight="plus" className="mt-1">{money(summary.total_principal, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Implied value</Text>
          <Text weight="plus" className="mt-1">{money(summary.total_implied_value, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Est. multiple</Text>
          <Text weight="plus" className="mt-1">{multiple == null ? "—" : `${multiple.toFixed(2)}×`}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Outstanding</Text>
          <Text weight="plus" className="mt-1">{summary.outstanding_count}</Text>
        </div>
      </div>

      <DataTable instance={table}>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

export const Component = () => {
  const { capTables, isPending } = useMyCapTable()
  const { convertibles, summary, isPending: safesPending } = useMyConvertibles()

  // Your outstanding (not-yet-converted) convertible principal, grouped by cap
  // table — feeds the "Your investment" nudge so a ₹0 equity tile still tells
  // the investor their loan/SAFE money is accounted for.
  const outstandingByCt = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of convertibles) {
      if ((c as any).status !== "outstanding") continue
      const cid = c.cap_table?.id ?? (c as any).cap_table_id
      if (!cid) continue
      const principal = Number((c as any).principal_amount ?? c.value?.principal ?? 0)
      m.set(cid, (m.get(cid) ?? 0) + principal)
    }
    return m
  }, [convertibles])

  if (isPending) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-6">
          <Skeleton className="h-48 w-full" />
        </Container>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <Heading level="h1">Cap Table</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Ownership overview across all companies
        </Text>
      </div>

      {capTables.length === 0 ? (
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
        capTables.map((ct) => (
          <CapTableSection
            key={ct.id}
            capTable={ct}
            outstandingPrincipal={outstandingByCt.get(ct.id) ?? 0}
          />
        ))
      )}

      {capTables.length > 0 && capTables.some((ct) => (ct.stakes ?? []).length > 0) && (
        <div className="flex flex-col gap-y-3">
          <Heading level="h2">Common Shares</Heading>
          <CapTableList capTables={capTables} />
        </div>
      )}

      {!safesPending && convertibles.length > 0 && (
        <SafesSection convertibles={convertibles} summary={summary} />
      )}
    </div>
  )
}
