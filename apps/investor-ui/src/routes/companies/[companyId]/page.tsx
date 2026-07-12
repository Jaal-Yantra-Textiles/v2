import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { ArrowDownTray, CurrencyDollar } from "@medusajs/icons"
import { useMemo } from "react"
import { useParams, Outlet, Link } from "react-router-dom"
import { ActionMenu } from "../../../components/common/action-menu/action-menu"
import {
  OwnershipDonut,
  type DonutSegment,
} from "../../../components/common/ownership-donut"
import {
  useMyCapTable,
  useMyDocuments,
  useDeals,
  useMyParticipations,
  type CapTableStake,
  type Deal,
  type InvestorDocument,
} from "../../../hooks/api/investments"
import {
  useMyProjections,
} from "../../../hooks/api/projections"

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
    case "rejected":
      return "red"
    case "not_followed_up":
      return "grey"
    default:
      return "grey"
  }
}

const prettyType = (t?: string) =>
  (t ?? "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const CapTableSection = ({
  capTableId,
  companyName,
}: {
  capTableId: string
  companyName: string
}) => {
  const { capTables } = useMyCapTable()
  const capTable = capTables.find((ct) => ct.id === capTableId || ct.company_id === capTableId)
  const stakes = capTable?.stakes ?? []
  const ccy = capTable?.currency_code

  const { segments, myInvested, totalRaised, visibleStakes } = useMemo(() => {
    // The cap table reflects only fully absorbed (fully_paid) stakes — matches
    // the admin. Pending/rejected/not-followed-up don't move ownership; declined
    // ones are hidden from the list entirely.
    const excluded = new Set(["rejected", "not_followed_up", "cancelled"])
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
    const visible = stakes.filter((s) => !excluded.has(s.status ?? ""))
    return {
      segments: segs,
      myInvested: mine,
      totalRaised: raised,
      visibleStakes: visible,
    }
  }, [stakes])

  if (!capTable) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Cap Table</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          {companyName} — ownership overview
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
            <Text weight="plus" className="mt-1">{money(capTable.post_money_valuation, ccy)}</Text>
          </div>
          <div className="rounded-lg border p-3">
            <Text size="small" className="text-ui-fg-subtle">Authorized shares</Text>
            <Text weight="plus" className="mt-1">{num(capTable.total_shares_authorized)}</Text>
          </div>
        </div>
      </div>

      {visibleStakes.length > 0 && (
        <StakesSection stakes={visibleStakes} ccy={ccy} />
      )}
    </Container>
  )
}

const StakesSection = ({
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
    <div className="flex flex-col gap-y-2 px-6 py-5">
      <Text weight="plus">Stakes</Text>
      <DataTable instance={table}>
        <DataTable.Table />
      </DataTable>
    </div>
  )
}

const DealsSection = ({ companyId }: { companyId: string }) => {
  const { deals, isPending } = useDeals()
  const companyDeals = deals.filter(
    (d: Deal) => d.cap_table?.company_id === companyId
  )

  // Hooks must run unconditionally and in a stable order — keep useDataTable
  // above the isPending/empty early returns (React #310 otherwise).
  const table = useDataTable({
    data: companyDeals,
    columns: [
      { header: "Name", accessorKey: "name" },
      {
        header: "Type",
        accessorKey: "round_type",
        cell: ({ row }: any) => <Badge size="2xsmall">{row.original.round_type ?? "round"}</Badge>,
      },
      {
        header: "Target",
        accessorKey: "target_amount",
        cell: ({ row }: any) => money(row.original.target_amount, row.original.cap_table?.currency_code),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={row.original.status === "closed" ? "grey" : "green"}>
            {row.original.status ?? "open"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) =>
          row.original.status !== "closed" && row.original.status !== "cancelled" ? (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <CurrencyDollar />,
                        label: "Participate",
                        to: `/finances/participate/${row.original.id}`,
                      },
                    ],
                  },
                ]}
              />
            </div>
          ) : null,
      },
    ],
  })

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Deals</Heading>
        </div>
        <div className="px-6 py-5">
          <Skeleton className="h-10 w-full" />
        </div>
      </Container>
    )
  }

  if (companyDeals.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Deals</Heading>
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

const DocumentsSection = ({ companyId }: { companyId: string }) => {
  const { documents, isPending } = useMyDocuments()
  const companyDocs = documents.filter(
    (d: InvestorDocument) => d.company_id === companyId
  )

  // useDataTable must run unconditionally, before the early returns (React #310).
  const table = useDataTable({
    data: companyDocs,
    columns: [
      { header: "Title", accessorKey: "title" },
      {
        header: "Type",
        accessorKey: "document_type",
        cell: ({ row }: any) => <Badge>{prettyType(row.original.document_type)}</Badge>,
      },
      {
        header: "Visibility",
        accessorKey: "visibility",
        cell: ({ row }: any) => (
          <Badge color={row.original.visibility === "public" ? "green" : "grey"}>
            {row.original.visibility ?? "investor"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const url = row.original.file_url as string | undefined
          return (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <ArrowDownTray />,
                        label: url ? "Open / download" : "No file",
                        disabled: !url,
                        onClick: () => url && window.open(url, "_blank", "noopener"),
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

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4"><Heading level="h2">Documents</Heading></div>
        <div className="px-6 py-5"><Skeleton className="h-10 w-full" /></div>
      </Container>
    )
  }

  if (companyDocs.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Documents</Heading>
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

const PositionSection = ({ companyId }: { companyId: string }) => {
  const { positions, portfolio, isPending } = useMyProjections()
  const position = positions.find((p) => p.company_id === companyId)

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4"><Heading level="h2">Your position</Heading></div>
        <div className="px-6 py-5"><Skeleton className="h-16 w-full" /></div>
      </Container>
    )
  }

  if (!position) return null

  const ccy = position.currency_code ?? undefined

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Your position</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Implied value based on post-money valuation.
        </Text>
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Invested</Text>
          <Text weight="plus" className="mt-1">{money(position.my_invested, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Implied value</Text>
          <Text weight="plus" className="mt-1">{money(position.implied_value, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Multiple</Text>
          <Text weight="plus" className="mt-1">
            {position.multiple == null ? "—" : `${position.multiple}×`}
          </Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Ownership</Text>
          <Text weight="plus" className="mt-1">
            {position.ownership_pct == null ? "—" : `${position.ownership_pct}%`}
          </Text>
        </div>
      </div>
    </Container>
  )
}

export const Component = () => {
  const { companyId } = useParams<{ companyId: string }>()
  const { capTables, isPending: ctPending } = useMyCapTable()

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const ct of capTables) {
      const cid = ct.company_id ?? ct.id
      if (!map.has(cid)) map.set(cid, ct.name)
    }
    return map
  }, [capTables])

  const companyName = companyId ? names.get(companyId) ?? "Company" : "Company"

  if (ctPending) {
    return (
      <div className="flex flex-col gap-y-3">
        <Skeleton className="h-12 w-64 rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }

  if (!companyId || !names.has(companyId)) {
    return (
      <div className="flex flex-col gap-y-3">
        <Heading level="h1">Company not found</Heading>
        <Text className="text-ui-fg-subtle">
          This company is not in your portfolio.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">{companyName}</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Company overview — cap table, deals, documents, and your position
          </Text>
        </div>
      </div>

      <CapTableSection capTableId={companyId} companyName={companyName} />
      <PositionSection companyId={companyId} />
      <DealsSection companyId={companyId} />
      <DocumentsSection companyId={companyId} />

      <Outlet />
    </div>
  )
}
