import { LoaderFunctionArgs, UIMatch, useLoaderData, useNavigate, useParams } from "react-router-dom"
import { Container, Heading, Text, Badge, Table, toast, Button } from "@medusajs/ui"
import { PencilSquare, Trash } from "@medusajs/icons"
import { Outlet } from "react-router-dom"
import { usePaymentReport, useDeletePaymentReport } from "../../../hooks/api/payment-reports"
import type { AdminPaymentReport } from "../../../hooks/api/payment-reports"
import { ActionMenu } from "../../../components/common/action-menu"
import { paymentReportLoader } from "./loader"

const PaymentReportDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialData = useLoaderData() as Awaited<{ payment_report: AdminPaymentReport }>

  const { payment_report, isPending: isLoading, isError, error } = usePaymentReport(id!, {
    initialData,
  }) as any

  const { mutateAsync: deleteReport, isPending: isDeleting } = useDeletePaymentReport()

  if (isLoading || !payment_report) {
    return (
      <div className="flex flex-col gap-y-4 p-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (isError) {
    throw error
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      return
    }
    try {
      await deleteReport(id!)
      toast.success("Payment report deleted")
      navigate("/payment-reports")
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete report")
    }
  }

  const by_status: Record<string, number> = payment_report.by_status ?? {}
  const by_type: Record<string, number> = payment_report.by_type ?? {}
  const by_month: Array<{ month: string; amount: number; count: number }> =
    payment_report.by_month ?? []

  return (
    <>
      <div className="flex flex-col gap-y-4">
        {/* Section 1 — Report Info */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading>{payment_report.name ?? `Report ${payment_report.id.slice(0, 8)}`}</Heading>
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: <PencilSquare />,
                      label: "Edit",
                      to: "@edit",
                    },
                    {
                      icon: <Trash />,
                      label: "Delete",
                      onClick: handleDelete,
                    },
                  ],
                },
              ]}
            />
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <Text size="small" className="text-ui-fg-subtle">Entity Type</Text>
                <Text>{payment_report.entity_type}</Text>
              </div>
              {payment_report.entity_id && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Entity ID</Text>
                  <Text>{payment_report.entity_id}</Text>
                </div>
              )}
              <div>
                <Text size="small" className="text-ui-fg-subtle">Period</Text>
                <Text>
                  {new Date(payment_report.period_start).toLocaleDateString()} →{" "}
                  {new Date(payment_report.period_end).toLocaleDateString()}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">Generated At</Text>
                <Text>{new Date(payment_report.generated_at).toLocaleString()}</Text>
              </div>
              {payment_report.filters?.status && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Status Filter</Text>
                  <Text>{payment_report.filters.status}</Text>
                </div>
              )}
              {payment_report.filters?.payment_type && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Payment Type Filter</Text>
                  <Text>{payment_report.filters.payment_type}</Text>
                </div>
              )}
            </div>
          </div>
        </Container>

        {/* Section 2 — Aggregate Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">Total Amount</Text>
            <Heading>₹{Number(payment_report.total_amount).toLocaleString()}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">Payment Count</Text>
            <Heading>{payment_report.payment_count}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">Distinct Statuses</Text>
            <Heading>{Object.keys(by_status).length}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">Distinct Types</Text>
            <Heading>{Object.keys(by_type).length}</Heading>
          </Container>
        </div>

        {/* Section 3 — By Status */}
        {Object.keys(by_status).length > 0 && (
          <Container className="p-4">
            <Heading level="h3" className="mb-3">By Status</Heading>
            <div className="flex flex-wrap gap-2">
              {Object.entries(by_status).map(([s, c]) => (
                <Badge key={s} color="grey">
                  {s}: {c}
                </Badge>
              ))}
            </div>
          </Container>
        )}

        {/* Section 4 — By Type */}
        {Object.keys(by_type).length > 0 && (
          <Container className="p-4">
            <Heading level="h3" className="mb-3">By Payment Type</Heading>
            <div className="flex flex-col gap-y-1">
              {Object.entries(by_type).map(([t, amount]) => (
                <div key={t} className="flex justify-between">
                  <Text>{t}</Text>
                  <Text className="text-ui-fg-subtle">₹{Number(amount).toLocaleString()}</Text>
                </div>
              ))}
            </div>
          </Container>
        )}

        {/* Section 5 — By Month */}
        {by_month.length > 0 && (
          <Container className="p-0">
            <div className="px-4 py-3 border-b border-ui-border-base">
              <Heading level="h3">By Month</Heading>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Month</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Count</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {by_month.map((row) => (
                  <Table.Row key={row.month}>
                    <Table.Cell>{row.month}</Table.Cell>
                    <Table.Cell>₹{Number(row.amount).toLocaleString()}</Table.Cell>
                    <Table.Cell>{row.count}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Container>
        )}
      </div>
      <Outlet />
    </>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await paymentReportLoader({ params })
}

export default PaymentReportDetailPage
