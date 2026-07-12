import {
  Badge,
  DataTable,
  Heading,
  Skeleton,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { ArrowPath, Check, Clock, CurrencyDollar, XMark } from "@medusajs/icons"
import { useSearchParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { ActionMenu } from "../../../../components/common/action-menu"
import {
  useApproveParticipation,
  useApproveConvertible,
  useMarkParticipationPaid,
  useRoundParticipations,
  useSetParticipationStatus,
  type AdminParticipation,
} from "../../../../hooks/api/cap-tables-admin"

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

const statusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
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

const statusLabel = (s?: string) => (s ? s.replace(/_/g, " ") : "unpaid")

const ParticipationsTable = ({
  roundId,
  participations,
}: {
  roundId: string
  participations: AdminParticipation[]
}) => {
  const approveToast = (r: any) =>
    toast.success(
      r?.payment_link
        ? "Approved — PayU link generated"
        : "Approved — pending payment (PayU not configured)"
    )
  const approveErr = (e: any) => toast.error(e?.message || "Approve failed")
  const { mutateAsync: approve } = useApproveParticipation(roundId, {
    onSuccess: approveToast,
    onError: approveErr,
  })
  // SAFE participants approve through the convertible route (same PayU rail).
  const { mutateAsync: approveConvertible } = useApproveConvertible("", {
    onSuccess: approveToast,
    onError: approveErr,
  })
  const { mutateAsync: markPaid } = useMarkParticipationPaid(roundId, {
    onSuccess: () => toast.success("Marked as paid"),
    onError: (e) => toast.error(e?.message || "Failed"),
  })
  const { mutateAsync: setStatus } = useSetParticipationStatus(roundId, {
    onSuccess: (r) => toast.success(`Moved to "${statusLabel(r?.status)}"`),
    onError: (e) => toast.error(e?.message || "Failed"),
  })

  const table = useDataTable({
    data: participations,
    columns: [
      {
        header: "Investor",
        accessorKey: "investor",
        cell: ({ row }: any) =>
          row.original.investor?.name ?? row.original.investor_id ?? "—",
      },
      {
        header: "Type",
        id: "type",
        cell: ({ row }: any) =>
          row.original.type === "convertible" ? (
            <Badge size="2xsmall" color="purple">SAFE</Badge>
          ) : (
            <Badge size="2xsmall" color="grey">Equity</Badge>
          ),
      },
      {
        header: "Amount",
        accessorKey: "total_invested",
        cell: ({ row }: any) => num(row.original.total_invested),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={statusColor(row.original.status)}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        header: "Pay link",
        id: "pay_link",
        cell: ({ row }: any) => {
          const link = row.original.payments?.find(
            (pm: any) => pm.metadata?.payu_payment_link
          )?.metadata?.payu_payment_link as string | undefined
          return link ? (
            <a href={link} target="_blank" rel="noreferrer" className="text-ui-fg-interactive">
              Open
            </a>
          ) : (
            "—"
          )
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const p = row.original as AdminParticipation
          const approved = !!p.metadata?.approved
          const isConvertible = p.type === "convertible"
          const isParked =
            p.status === "rejected" || p.status === "not_followed_up"
          return (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <Check />,
                        label: "Approve (generate pay link)",
                        disabled: approved || isParked,
                        onClick: () =>
                          isConvertible ? approveConvertible(p.id) : approve(p.id),
                      },
                      // Mark-paid uses the stake ledger; only equity stakes support it.
                      {
                        icon: <CurrencyDollar />,
                        label: "Mark paid",
                        disabled:
                          isConvertible || isParked || p.status === "fully_paid",
                        onClick: () => markPaid(p.id),
                      },
                    ],
                  },
                  // Lifecycle states (equity only, like mark-paid). Excluded from
                  // the cap table until fully_paid.
                  {
                    actions: isParked
                      ? [
                          {
                            icon: <ArrowPath />,
                            label: "Reopen (back to unpaid)",
                            disabled: isConvertible,
                            onClick: () =>
                              setStatus({ stakeId: p.id, status: "unpaid" }),
                          },
                        ]
                      : [
                          {
                            icon: <XMark />,
                            label: "Reject",
                            disabled: isConvertible || p.status === "fully_paid",
                            onClick: () =>
                              setStatus({ stakeId: p.id, status: "rejected" }),
                          },
                          {
                            icon: <Clock />,
                            label: "Not followed up",
                            disabled: isConvertible || p.status === "fully_paid",
                            onClick: () =>
                              setStatus({
                                stakeId: p.id,
                                status: "not_followed_up",
                              }),
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

  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

const ParticipationsBody = ({ roundId }: { roundId: string }) => {
  const { participations = [], isPending } = useRoundParticipations(roundId)
  if (isPending) return <Skeleton className="h-24 w-full" />
  if (participations.length === 0)
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No participations yet.
      </Text>
    )
  return <ParticipationsTable roundId={roundId} participations={participations} />
}

const ParticipationsPage = () => {
  const [params] = useSearchParams()
  const roundId = params.get("round_id") ?? ""

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-3xl flex-col gap-y-4">
          <Heading level="h2">Participations</Heading>
          {roundId ? (
            <ParticipationsBody roundId={roundId} />
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              No round selected.
            </Text>
          )}
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default ParticipationsPage
