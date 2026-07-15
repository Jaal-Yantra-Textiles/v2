import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { CheckCircleSolid, CreditCard, CurrencyDollar, XCircleSolid } from "@medusajs/icons"
import { Outlet, useSearchParams } from "react-router-dom"
import { useState } from "react"
import { ActionMenu } from "../../components/common/action-menu/action-menu"
import { useIsViewOnly } from "../../hooks/api/companies"
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
    case "paid":
      return "green"
    case "awaiting payment":
    case "unpaid":
    case "partially_paid":
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

// A convertible (SAFE / CCPS) has no `fully_paid` instrument state — settlement
// lives on its payment. Treat a participation as paid once any payment is
// `completed` (or a stake reaches fully_paid). This keeps an approved-but-unpaid
// convertible from reading as already invested.
const isPaid = (p: Participation) =>
  p.status === "fully_paid" ||
  !!p.payments?.some((pm) => pm.status === "completed")

// Payment-aware badge label. Convertibles show payment reality rather than the
// raw "outstanding" instrument status.
const displayStatus = (p: Participation): string => {
  if (isPaid(p)) return "paid"
  if (p.type === "convertible") return "awaiting payment"
  return p.status ?? "unpaid"
}

const DealsTable = () => {
  const { deals, isPending } = useDeals()
  const isViewOnly = useIsViewOnly()

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
        cell: ({ row }: any) =>
          isViewOnly ? (
            <div className="flex justify-end">
              <Text size="xsmall" className="text-ui-fg-muted">
                View-only
              </Text>
            </div>
          ) : (
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
        cell: ({ row }: any) => {
          const s = displayStatus(row.original as Participation)
          return <Badge color={statusColor(s)}>{s}</Badge>
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const p = row.original as Participation
          const link = payLink(p)
          if (isPaid(p)) {
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

// Confirmation banner shown when PayU redirects back to /finances?paid=1 (or
// ?paid=0 on failure). Settlement itself is server-side via the PayU webhook and
// can lag the redirect by a few seconds, so the success copy sets that
// expectation rather than asserting the row is already updated.
const PaymentReturnBanner = () => {
  const [params, setParams] = useSearchParams()
  const paid = params.get("paid")
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || (paid !== "1" && paid !== "0")) return null

  const success = paid === "1"

  const clear = () => {
    setDismissed(true)
    params.delete("paid")
    setParams(params, { replace: true })
  }

  return (
    <div
      className={`flex items-start gap-x-3 rounded-lg border px-4 py-3 ${
        success
          ? "border-ui-tag-green-border bg-ui-tag-green-bg"
          : "border-ui-tag-red-border bg-ui-tag-red-bg"
      }`}
      role="status"
    >
      {success ? (
        <CheckCircleSolid className="text-ui-tag-green-icon mt-0.5 shrink-0" />
      ) : (
        <XCircleSolid className="text-ui-tag-red-icon mt-0.5 shrink-0" />
      )}
      <div className="flex-1">
        <Text size="small" weight="plus">
          {success ? "Payment received — thank you." : "Payment not completed"}
        </Text>
        <Text size="small" className="text-ui-fg-subtle mt-0.5">
          {success
            ? "We're confirming it with the payment provider. Your participation below will update to “Paid” within a few moments."
            : "The payment wasn't completed. You can retry from “My participations” below, or reach out if you were charged."}
        </Text>
      </div>
      <button
        onClick={clear}
        className="text-ui-fg-muted hover:text-ui-fg-subtle text-sm"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
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

      <PaymentReturnBanner />
      <DealsTable />
      <MyParticipationsTable />
      <Outlet />
    </div>
  )
}
