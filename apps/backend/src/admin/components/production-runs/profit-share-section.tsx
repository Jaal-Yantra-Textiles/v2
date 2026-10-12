import { Badge, Button, Heading, Input, Label, Select, Text, toast } from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import { useState } from "react"

import {
  useDeleteProfitSharePayment,
  useDeleteProfitShareSale,
  useProductionRunProfitShare,
  useRecordProfitSharePayment,
  useRecordProfitShareSale,
  useSetProfitSharePercent,
} from "../../hooks/api/production-run-profit-share"

/**
 * #2322 — Profit share on a run the PARTNER made with OUR material.
 *
 * The reverse of a payout: they sell the pieces and pay us a share of the
 * gross sale price. This section records the arrangement, their sales and the
 * bank/cash payments they make us, and shows what is still owed — computed by
 * the server from those rows, with its working.
 */

const money = (n: number | null | undefined, ccy: string) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: ccy.toUpperCase() }).format(n)

const STATUS: Record<string, { label: string; color: "grey" | "orange" | "green" | "blue" }> = {
  none: { label: "No arrangement", color: "grey" },
  no_sales: { label: "Nothing sold yet", color: "grey" },
  open: { label: "Balance owed", color: "orange" },
  settled: { label: "Settled", color: "green" },
  overpaid: { label: "Overpaid", color: "blue" },
}

const errorMessage = (e: unknown) => (e as any)?.message ?? "Something went wrong"

export const ProfitShareSection = ({ runId }: { runId: string }) => {
  const { data, isLoading } = useProductionRunProfitShare(runId)
  const setPercent = useSetProfitSharePercent(runId)
  const addSale = useRecordProfitShareSale(runId)
  const delSale = useDeleteProfitShareSale(runId)
  const addPayment = useRecordProfitSharePayment(runId)
  const delPayment = useDeleteProfitSharePayment(runId)

  const [percentInput, setPercentInput] = useState("")
  const [saleQty, setSaleQty] = useState("")
  const [salePrice, setSalePrice] = useState("")
  const [payAmount, setPayAmount] = useState("")
  const [payMethod, setPayMethod] = useState<"bank_transfer" | "cash">("bank_transfer")
  const [payRef, setPayRef] = useState("")

  if (isLoading || !data) {
    return (
      <div className="px-6 py-4">
        <Heading level="h2">Profit share</Heading>
      </div>
    )
  }

  const ps = data.profit_share
  const s = ps.summary
  const ccy = s.currency_code || "inr"
  const status = STATUS[s.status] ?? STATUS.none

  const run = (p: Promise<unknown>, ok: string) =>
    p.then(() => toast.success(ok)).catch((e) => toast.error(errorMessage(e)))

  return (
    <>
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Profit share</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Partner made these on our material and pays us a share of what they sell.
          </Text>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-3 px-6 py-4">
        <div>
          <Label size="small">Our share of gross sales (%)</Label>
          <Input
            size="small"
            type="number"
            placeholder={ps.percent === null ? "e.g. 50" : String(ps.percent)}
            value={percentInput}
            onChange={(e) => setPercentInput(e.target.value)}
          />
        </div>
        <Button
          size="small"
          variant="secondary"
          isLoading={setPercent.isPending}
          disabled={percentInput === ""}
          onClick={() =>
            run(
              setPercent.mutateAsync({ percent: Number(percentInput) }),
              "Share saved"
            ).then(() => setPercentInput(""))
          }
        >
          {ps.percent === null ? "Set share" : "Change share"}
        </Button>
        {ps.percent !== null && (
          <Text size="small" className="text-ui-fg-subtle">
            Currently {ps.percent}%
          </Text>
        )}
      </div>

      {ps.percent !== null && (
        <>
          <div className="grid grid-cols-2 gap-4 px-6 py-4 md:grid-cols-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Sold</Text>
              <Text>
                {s.sold_quantity}
                {s.run_quantity !== null ? ` of ${s.run_quantity}` : ""}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Gross sales</Text>
              <Text>{money(s.gross_sales, ccy)}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Owed to us · paid</Text>
              <Text>
                {money(s.owed, ccy)} · {money(s.paid, ccy)}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Balance</Text>
              <Text weight="plus">{money(s.balance, ccy)}</Text>
            </div>
            {s.currency_mismatch && (
              <Text size="small" className="col-span-full text-ui-fg-error">
                Rows are in more than one currency — the totals are not reliable.
              </Text>
            )}
            {s.working.length > 0 && (
              <Text size="xsmall" className="col-span-full text-ui-fg-muted">
                {s.working.join(" · ")}
              </Text>
            )}
          </div>

          {/* Sales */}
          <div className="px-6 py-4">
            <Text weight="plus" size="small">Sales</Text>
            {ps.sales.map((sale) => (
              <div key={sale.id} className="flex items-center justify-between py-1">
                <Text size="small">
                  {new Date(sale.sold_at).toLocaleDateString()} · {sale.quantity} ×{" "}
                  {money(Number(sale.unit_price), sale.currency_code)}
                  {sale.reported_by === "partner" ? " · reported by partner" : ""}
                  {sale.note ? ` · ${sale.note}` : ""}
                </Text>
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => run(delSale.mutateAsync(sale.id), "Sale removed")}
                >
                  <Trash />
                </Button>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input size="small" type="number" placeholder="Pieces" value={saleQty} onChange={(e) => setSaleQty(e.target.value)} />
              <Input size="small" type="number" placeholder="Price per piece (gross)" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              <Button
                size="small"
                variant="secondary"
                isLoading={addSale.isPending}
                disabled={!saleQty || !salePrice}
                onClick={() =>
                  run(
                    addSale.mutateAsync({ quantity: Number(saleQty), unit_price: Number(salePrice) }),
                    "Sale recorded"
                  ).then(() => {
                    setSaleQty("")
                    setSalePrice("")
                  })
                }
              >
                Record sale
              </Button>
            </div>
          </div>

          {/* Payments to us */}
          <div className="px-6 py-4">
            <Text weight="plus" size="small">Payments received from partner</Text>
            {ps.settlements.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1">
                <Text size="small">
                  {new Date(p.paid_at).toLocaleDateString()} · {money(Number(p.amount), p.currency_code)} ·{" "}
                  {p.method === "cash" ? "Cash" : "Bank transfer"}
                  {p.reference ? ` · ${p.reference}` : ""}
                </Text>
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => run(delPayment.mutateAsync(p.id), "Payment removed")}
                >
                  <Trash />
                </Button>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input size="small" type="number" placeholder="Amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <Select size="small" value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="bank_transfer">Bank transfer</Select.Item>
                  <Select.Item value="cash">Cash</Select.Item>
                </Select.Content>
              </Select>
              <Input
                size="small"
                placeholder={payMethod === "cash" ? "Received by" : "UTR"}
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
              <Button
                size="small"
                variant="secondary"
                isLoading={addPayment.isPending}
                disabled={!payAmount}
                onClick={() =>
                  run(
                    addPayment.mutateAsync({
                      amount: Number(payAmount),
                      method: payMethod,
                      ...(payRef ? { reference: payRef } : {}),
                    }),
                    "Payment recorded"
                  ).then(() => {
                    setPayAmount("")
                    setPayRef("")
                  })
                }
              >
                Record payment
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
