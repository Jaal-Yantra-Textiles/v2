import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, StatusBadge, Text, toast, usePrompt } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { API_BASE_URL, sdk } from "../lib/config"

/**
 * GST tax invoices for an order (#2532): issue the numbered bill, download its
 * PDF, and see cancelled ones. Issuing an unchanged order again returns the
 * same invoice; a changed order is offered a reissue, which cancels the old.
 * "Email" sends the current invoice through the `order-tax-invoice` email
 * template with the PDF attached, after showing who it goes to.
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

  const send = useMutation({
    mutationFn: ({ id, preview }: { id: string; preview: boolean }) =>
      sdk.client.fetch<{ to: string; invoice_number: string; attachment: string }>(
        `/admin/tax-invoices/${id}/send`,
        { method: "POST", body: preview ? { preview: true } : { confirm: true } }
      ),
  })

  const invoices = data?.tax_invoices ?? []
  const current = invoices.find((i) => i.status === "issued") ?? null

  const openPdf = (id: string) =>
    window.open(`${API_BASE_URL}/admin/tax-invoices/${id}/pdf`, "_blank")

  const handleEmail = async (inv: TaxInvoiceRow) => {
    try {
      const preview = await send.mutateAsync({ id: inv.id, preview: true })
      const confirmed = await prompt({
        title: `Email ${inv.invoice_number}?`,
        description: `Sends the "order-tax-invoice" email to ${preview.to} with ${preview.attachment} attached. An email cannot be recalled.`,
        confirmText: "Send",
        cancelText: "Cancel",
      })
      if (!confirmed) return
      await send.mutateAsync({ id: inv.id, preview: false })
      toast.success(`Emailed ${inv.invoice_number} to ${preview.to}`)
    } catch (e: any) {
      toast.error("Could not email the invoice", { description: e?.message })
    }
  }

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
            <div className="flex items-center gap-x-1">
              {inv.status === "issued" && (
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => handleEmail(inv)}
                  disabled={send.isPending}
                >
                  Email
                </Button>
              )}
              <Button size="small" variant="transparent" onClick={() => openPdf(inv.id)}>
                PDF
              </Button>
            </div>
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
