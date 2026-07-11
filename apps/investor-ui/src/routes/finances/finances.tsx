import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { CreditCard, CurrencyDollar } from "@medusajs/icons"
import { Outlet } from "react-router-dom"
import { ActionMenu } from "../../components/common/action-menu/action-menu"
import {
  useDeals,
  useMyParticipations,
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

const DealsTable = () => {
  const { deals, isPending } = useDeals()

  const table = useDataTable({
    data: deals,
    columns: [
      { header: "Deal", accessorKey: "name" },
      {
        header: "Type",
        accessorKey: "round_type",
        cell: ({ row }: any) => <Badge size="2xsmall">{row.original.round_type ?? "round"}</Badge>,
      },
      {
        header: "Company",
        accessorKey: "cap_table",
        cell: ({ row }: any) => row.original.cap_table?.name ?? "—",
      },
      {
        header: "Target",
        accessorKey: "target_amount",
        cell: ({ row }: any) =>
          money(row.original.target_amount, row.original.cap_table?.currency_code),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => (
          <div className="flex justify-end">
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: <CurrencyDollar />,
                      label: "Participate",
                      to: `participate/${row.original.id}`,
                    },
                  ],
                },
              ]}
            />
          </div>
        ),
      },
    ],
  })

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Open deals</Heading>
        </div>
        <div className="flex flex-col gap-y-2 px-6 py-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Container>
    )
  }

  if (deals.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Open deals</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Live rounds from the companies you're following.
          </Text>
        </div>
        <div className="px-6 py-5">
          <Text size="small" className="text-ui-fg-subtle">No open deals right now.</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Open deals</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Live rounds from the companies you're following.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

const payLink = (p: Participation): string | undefined =>
  p.payments?.find((pm) => pm.metadata?.payu_payment_link)?.metadata
    ?.payu_payment_link as string | undefined

const MyParticipationsTable = () => {
  const { participations, isPending } = useMyParticipations()

  const table = useDataTable({
    data: participations,
    columns: [
      {
        header: "Deal",
        accessorKey: "funding_round",
        cell: ({ row }: any) => row.original.funding_round?.name ?? "—",
      },
      {
        header: "Company",
        accessorKey: "cap_table",
        cell: ({ row }: any) => row.original.cap_table?.name ?? "—",
      },
      {
        header: "Amount",
        accessorKey: "total_invested",
        cell: ({ row }: any) => money(row.original.total_invested),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={statusColor(row.original.status)}>
            {row.original.status ?? "unpaid"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const p = row.original as Participation
          const link = payLink(p)
          if (p.status === "fully_paid") {
            return (
              <div className="flex justify-end">
                <Text size="small" className="text-ui-fg-subtle">Paid</Text>
              </div>
            )
          }
          return (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <CreditCard />,
                        label: link ? "Pay now" : "Awaiting approval",
                        disabled: !link,
                        onClick: () => link && window.open(link, "_blank", "noopener"),
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
        <div className="px-6 py-4">
          <Heading level="h2">My participations</Heading>
        </div>
        <div className="px-6 py-5">
          <Skeleton className="h-10 w-full" />
        </div>
      </Container>
    )
  }

  if (participations.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">My participations</Heading>
        </div>
        <div className="px-6 py-5">
          <Text size="small" className="text-ui-fg-subtle">
            You haven't participated in any deals yet.
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">My participations</Heading>
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

export const Finances = () => {
  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <Heading level="h1">Finances</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Deals, investments, and payment activity
        </Text>
      </div>

      <DealsTable />
      <MyParticipationsTable />
      <Outlet />
    </div>
  )
}
