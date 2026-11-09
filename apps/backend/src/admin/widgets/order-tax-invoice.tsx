import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, StatusBadge, Text, toast, usePrompt } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { API_BASE_URL, sdk } from "../lib/config"

/**
 * GST tax invoices for an order (#2532): issue the numbered bill, download its
 * PDF, and see cancelled ones. Issuing an unchanged order again returns the
 * same invoice; a changed order is offered a reissue, which cancels the old.
 * Nothing here emails the customer.
 */
type AdminOrder = { id: string }

type TaxInvoiceRow = {
  id: string
  invoice_number: string
  status: "issued" | "cancelled"
  issued_at: string
  currency_code: string
  grand_total: number
  cancel_reason: string | null
}

const fmtMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(Number(amount ?? 0))

const OrderTaxInvoiceWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const queryKey = ["order-tax-invoices", order.id]

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () =>
      sdk.client.fetch<{ tax_invoices: TaxInvoiceRow[] }>(
        `/admin/orders/${order.id}/tax-invoices`,
        { method: "GET" }
      ),
  })

  const issue = useMutation({
    mutationFn: (body: { reissue?: boolean }) =>
      sdk.client.fetch<{ tax_invoice: TaxInvoiceRow; created: boolean }>(
        `/admin/orders/${order.id}/tax-invoices`,
        { method: "POST", body }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const invoices = data?.tax_invoices ?? []
  const current = invoices.find((i) => i.status === "issued") ?? null

  const openPdf = (id: string) =>
    window.open(`${API_BASE_URL}/admin/tax-invoices/${id}/pdf`, "_blank")

  const handleIssue = async () => {
    const confirmed = await prompt({
      title: current ? "Check the tax invoice" : "Issue tax invoice?",
      description: current
        ? `If the order is unchanged you get ${current.invoice_number} back. If it changed, you'll be asked to reissue.`
        : "This assigns the next GST invoice number. It cannot be deleted later, only cancelled. Nothing is emailed.",
      confirmText: current ? "Check" : "Issue",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    try {
      const res = await issue.mutateAsync({})
      toast.success(
        res.created
          ? `Issued ${res.tax_invoice.invoice_number}`
          : `Unchanged: still ${res.tax_invoice.invoice_number}`
      )
      openPdf(res.tax_invoice.id)
    } catch (e: any) {
      const changed = /reissue/i.test(e?.message ?? "")
      if (!changed) {
        toast.error("Could not issue the invoice", { description: e?.message })
        return
      }
      const reissue = await prompt({
        title: "The order changed",
        description: `${e.message} The old invoice stays on record as cancelled.`,
        confirmText: "Cancel it and reissue",
        cancelText: "Keep the old one",
      })
      if (!reissue) return
      try {
        const res = await issue.mutateAsync({ reissue: true })
        toast.success(`Issued ${res.tax_invoice.invoice_number}`)
        openPdf(res.tax_invoice.id)
      } catch (err: any) {
        toast.error("Could not reissue the invoice", { description: err?.message })
      }
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Tax invoice</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Numbered GST bill for this order
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={handleIssue}
          disabled={issue.isPending}
          isLoading={issue.isPending}
        >
          {current ? "Check / reissue" : "Issue invoice"}
        </Button>
      </div>

      {isPending ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      ) : isError ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Could not load invoices</Text>
        </div>
      ) : !invoices.length ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">No invoice issued yet</Text>
        </div>
      ) : (
        invoices.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-x-3 px-6 py-3">
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-x-2">
                <Text size="small" leading="compact" weight="plus">
                  {inv.invoice_number}
                </Text>
                <StatusBadge color={inv.status === "issued" ? "green" : "grey"}>
                  {inv.status === "issued" ? "Issued" : "Cancelled"}
                </StatusBadge>
              </div>
              <Text size="small" leading="compact" className="text-ui-fg-subtle truncate">
                {new Date(inv.issued_at).toLocaleDateString("en-IN")} ·{" "}
                {fmtMoney(inv.grand_total, inv.currency_code)}
                {inv.cancel_reason ? ` · ${inv.cancel_reason}` : ""}
              </Text>
            </div>
            <Button size="small" variant="transparent" onClick={() => openPdf(inv.id)}>
              PDF
            </Button>
          </div>
        ))
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderTaxInvoiceWidget
