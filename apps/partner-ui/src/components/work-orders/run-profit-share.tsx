import {
  Alert,
  Badge,
  Button,
  Drawer,
  Input,
  StatusBadge,
  Text,
  Textarea,
  clx,
  toast,
} from "@medusajs/ui"
import { useState, type FormEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import {
  PartnerProfitShare,
  PartnerProfitShareStatus,
  usePartnerRunProfitShare,
  useReportPartnerSale,
} from "../../hooks/api/partner-production-runs"
import { useDate } from "../../hooks/use-date"
import { extractErrorMessage } from "../../lib/extract-error-message"
import { getLocaleAmount } from "../../lib/money-amount-helpers"
import {
  SaleFormError,
  buildSalePayload,
  hasProfitShareDeal,
  localDateInputValue,
  saleLineTotal,
} from "../../lib/profit-share"

const STATUS_COLOR: Record<
  PartnerProfitShareStatus,
  "green" | "orange" | "red" | "blue" | "grey"
> = {
  none: "grey",
  no_sales: "grey",
  open: "orange",
  settled: "green",
  overpaid: "blue",
}

const money = (amount: unknown, currencyCode: string | null | undefined) => {
  const n = Number(amount) || 0
  try {
    return getLocaleAmount(n, (currencyCode || "inr").toLowerCase())
  } catch {
    return `${(currencyCode || "").toUpperCase()} ${n}`.trim()
  }
}

/**
 * #2401 — "Profit share" on a run the partner made with our material (#2322).
 *
 * Renders NOTHING unless the run has a deal: `percent: null` / `owed: null`
 * means there is no arrangement, and showing "₹0 owed" would say there is one.
 * A founder decision keeps this a sheet on the run, not a page of its own.
 *
 * `profitSharePercent` is the run's own field when the partner API carries it —
 * an explicit `null` skips the fetch entirely; `undefined` (field absent) asks.
 */
export const RunProfitShareButton = ({
  runId,
  profitSharePercent,
}: {
  runId: string
  profitSharePercent?: number | null
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { profit_share } = usePartnerRunProfitShare(runId, {
    enabled: !!runId && profitSharePercent !== null,
    retry: false,
  })

  if (!hasProfitShareDeal(profit_share)) return null

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        onClick={() => setOpen(true)}
        className="w-full shrink-0 sm:w-auto"
      >
        {t("partner.workOrders.profitShare.button")}
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>{t("partner.workOrders.profitShare.title")}</Drawer.Title>
            <Drawer.Description>
              {t("partner.workOrders.profitShare.description", {
                percent: profit_share!.percent,
              })}
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
            <ProfitShareSummary profitShare={profit_share!} />
            <ProfitShareSales profitShare={profit_share!} />
            <ProfitSharePayments profitShare={profit_share!} />
            <ReportSaleForm runId={runId} />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </>
  )
}

const SummaryRow = ({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: ReactNode
  emphasis?: boolean
}) => (
  <div className="flex items-center justify-between gap-x-4">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text
      size={emphasis ? "base" : "small"}
      weight={emphasis ? "plus" : "regular"}
      className={clx("text-right", { "text-ui-fg-base": emphasis })}
    >
      {value}
    </Text>
  </div>
)

const ProfitShareSummary = ({ profitShare }: { profitShare: PartnerProfitShare }) => {
  const { t } = useTranslation()
  const s = profitShare.summary
  const cc = s.currency_code

  return (
    <div className="flex flex-col gap-y-2 rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
      <SummaryRow
        label={t("partner.workOrders.profitShare.status")}
        value={
          <StatusBadge color={STATUS_COLOR[s.status] ?? "grey"}>
            {t(`partner.workOrders.profitShare.statuses.${s.status}`)}
          </StatusBadge>
        }
      />
      <SummaryRow
        label={t("partner.workOrders.profitShare.percent")}
        value={`${s.percent ?? profitShare.percent}%`}
      />
      <SummaryRow
        label={t("partner.workOrders.profitShare.sold")}
        value={
          s.run_quantity === null
            ? String(s.sold_quantity)
            : t("partner.workOrders.profitShare.soldOfRun", {
                sold: s.sold_quantity,
                total: s.run_quantity,
              })
        }
      />
      {/* Mixed currencies: the server refuses to add them up, and so do we. */}
      {s.currency_mismatch ? (
        <Alert variant="warning">
          {t("partner.workOrders.profitShare.currencyMismatch")}
        </Alert>
      ) : (
        <>
          <SummaryRow
            label={t("partner.workOrders.profitShare.grossSales")}
            value={money(s.gross_sales, cc)}
          />
          <SummaryRow
            label={t("partner.workOrders.profitShare.owed")}
            value={money(s.owed, cc)}
            emphasis
          />
          <SummaryRow
            label={t("partner.workOrders.profitShare.paid")}
            value={money(s.paid, cc)}
          />
          <SummaryRow
            label={t("partner.workOrders.profitShare.balance")}
            value={money(s.balance, cc)}
          />
        </>
      )}
    </div>
  )
}

const ProfitShareSales = ({ profitShare }: { profitShare: PartnerProfitShare }) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const sales = profitShare.sales ?? []

  return (
    <div className="flex flex-col gap-y-2">
      <Text size="small" weight="plus">
        {t("partner.workOrders.profitShare.sales")}
      </Text>
      {sales.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.workOrders.profitShare.noSales")}
        </Text>
      ) : (
        <div className="divide-y rounded-xl border border-ui-border-base">
          {sales.map((sale) => (
            <div key={sale.id} className="flex flex-col gap-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-x-3">
                <Text size="small" weight="plus">
                  {getFullDate({ date: sale.sold_at })}
                </Text>
                <Badge size="2xsmall" color={sale.reported_by === "partner" ? "blue" : "grey"}>
                  {t(
                    sale.reported_by === "partner"
                      ? "partner.workOrders.profitShare.reporter.partner"
                      : "partner.workOrders.profitShare.reporter.admin"
                  )}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-x-3">
                <Text size="small" className="text-ui-fg-subtle">
                  {Number(sale.quantity)} × {money(sale.unit_price, sale.currency_code)}
                </Text>
                <Text size="small" weight="plus">
                  {money(saleLineTotal(sale), sale.currency_code)}
                </Text>
              </div>
              {sale.note && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {sale.note}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ProfitSharePayments = ({ profitShare }: { profitShare: PartnerProfitShare }) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const settlements = profitShare.settlements ?? []

  return (
    <div className="flex flex-col gap-y-2">
      <Text size="small" weight="plus">
        {t("partner.workOrders.profitShare.payments")}
      </Text>
      {settlements.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.workOrders.profitShare.noPayments")}
        </Text>
      ) : (
        <div className="divide-y rounded-xl border border-ui-border-base">
          {settlements.map((p) => (
            <div key={p.id} className="flex flex-col gap-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-x-3">
                <Text size="small" weight="plus">
                  {getFullDate({ date: p.paid_at })}
                </Text>
                <Text size="small" weight="plus">
                  {money(p.amount, p.currency_code)}
                </Text>
              </div>
              {p.reference && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("partner.workOrders.profitShare.reference")}: {p.reference}
                </Text>
              )}
              {p.note && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {p.note}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ReportSaleForm = ({ runId }: { runId: string }) => {
  const { t } = useTranslation()
  const [quantity, setQuantity] = useState("")
  const [unitPrice, setUnitPrice] = useState("")
  const [soldOn, setSoldOn] = useState(() => localDateInputValue())
  const [note, setNote] = useState("")
  const [fieldError, setFieldError] = useState<SaleFormError | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const report = useReportPartnerSale(runId, {
    onSuccess: () => {
      toast.success(t("partner.workOrders.profitShare.report.success"))
      setQuantity("")
      setUnitPrice("")
      setNote("")
      setSoldOn(localDateInputValue())
    },
    // e.g. 400 "Selling 6 would report 12 sold, more than the run's 10 pieces."
    onError: (e) => setServerError(extractErrorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setServerError(null)
    const res = buildSalePayload({ quantity, unitPrice, soldOn, note })
    if (!res.ok) {
      setFieldError(res.error)
      return
    }
    setFieldError(null)
    report.mutate(res.payload)
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-y-3 rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4"
    >
      <Text size="small" weight="plus">
        {t("partner.workOrders.profitShare.report.heading")}
      </Text>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">
            {t("partner.workOrders.profitShare.report.quantity")}
          </Text>
          <Input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={quantity}
            aria-invalid={fieldError === "quantity"}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">
            {t("partner.workOrders.profitShare.report.unitPrice")}
          </Text>
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={unitPrice}
            aria-invalid={fieldError === "unitPrice"}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Text size="xsmall" className="text-ui-fg-subtle mb-1">
          {t("partner.workOrders.profitShare.report.soldOn")}
        </Text>
        <Input
          type="date"
          value={soldOn}
          max={localDateInputValue()}
          aria-invalid={fieldError === "soldOn"}
          onChange={(e) => setSoldOn(e.target.value)}
        />
      </div>
      <div>
        <Text size="xsmall" className="text-ui-fg-subtle mb-1">
          {t("partner.workOrders.profitShare.report.note")}
        </Text>
        <Textarea
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {fieldError && (
        <Text size="xsmall" className="text-ui-fg-error">
          {t(`partner.workOrders.profitShare.report.errors.${fieldError}`)}
        </Text>
      )}
      {serverError && <Alert variant="error">{serverError}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" size="small" isLoading={report.isPending}>
          {t("partner.workOrders.profitShare.report.submit")}
        </Button>
      </div>
    </form>
  )
}
