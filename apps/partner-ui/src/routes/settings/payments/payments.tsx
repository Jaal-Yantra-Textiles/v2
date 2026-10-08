import { PencilSquare, Trash } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Text,
  createDataTableColumnHelper,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { ActionMenu } from "../../../components/common/action-menu"
import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table"
import { getLocaleAmount } from "../../../lib/money-amount-helpers"
import { usePartnerPayments } from "../../../hooks/api/partner-payments"
import { usePartnerPaymentSubmissions } from "../../../hooks/api/partner-payment-submissions"
import {
  useDeletePartnerPaymentMethod,
  usePartnerPaymentMethods,
} from "../../../hooks/api/partner-payment-methods"
import { useMe } from "../../../hooks/api/users"
import { useDataTable } from "../../../hooks/use-data-table"

type PaymentMethodRow = {
  id: string
  type: string
  account_name: string
  account_number?: string | null
  bank_name?: string | null
  ifsc_code?: string | null
  wallet_id?: string | null
  created_at?: string | null
}

type PaymentMethodRowActionsProps = {
  method: PaymentMethodRow
  partnerId?: string | null
}

const PaymentMethodRowActions = ({
  method,
  partnerId,
}: PaymentMethodRowActionsProps) => {
  const { t } = useTranslation()
  const prompt = usePrompt()

  const { mutateAsync } = useDeletePartnerPaymentMethod(
    partnerId || "",
    method.id
  )

  const handleDelete = useCallback(async () => {
    const confirmed = await prompt({
      title: t("general.areYouSure"),
      description: t("partner.payments.delete.confirmation", {
        accountName: method.account_name,
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    })

    if (!confirmed) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(t("partner.payments.toast.deleted"))
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  }, [mutateAsync, prompt, t, method.account_name])

  return (
    <ActionMenu
      groups={[
        {
          actions: [
            {
              icon: <PencilSquare />,
              label: t("actions.edit"),
              to: `${method.id}/edit`,
            },
          ],
        },
        {
          actions: [
            {
              icon: <Trash />,
              label: t("actions.delete"),
              onClick: handleDelete,
            },
          ],
        },
      ]}
    />
  )
}

export const SettingsPayments = () => {
  const { t } = useTranslation()
  const { user } = useMe()
  const partnerId = user?.partner_id

  const { payments, isPending: isPaymentsLoading } = usePartnerPayments(partnerId)
  // Since #1636 settling a request marks it Paid and writes no payment row, so
  // the Paid request IS the payout. Reading payments alone left this list
  // empty for every payout settled the current way.
  const { payment_submissions: paidRequests, isPending: isPaidLoading } =
    usePartnerPaymentSubmissions({ status: "Paid", limit: 100 }, { enabled: !!partnerId })
  const { paymentMethods, isPending: isMethodsLoading } = usePartnerPaymentMethods(partnerId)

  const rows = useMemo<PaymentMethodRow[]>(() => {
    return (paymentMethods || []).map((m) => ({
      id: String(m.id),
      type: String(m.type || ""),
      account_name: String(m.account_name || ""),
      account_number: m.account_number ?? null,
      bank_name: m.bank_name ?? null,
      ifsc_code: m.ifsc_code ?? null,
      wallet_id: m.wallet_id ?? null,
      created_at: m.created_at ?? null,
    }))
  }, [paymentMethods])

  type PaymentRow = {
    id: string
    kind: "request" | "payment"
    label: string
    amount?: number | null
    currency_code?: string | null
    created_at?: string | null
  }

  // Paid requests first (newest paid first), then the older recorded payments.
  const paymentRows = useMemo<PaymentRow[]>(() => {
    const time = (v?: string | null) => (v ? new Date(v).getTime() || 0 : 0)
    const requests: PaymentRow[] = (paidRequests || [])
      .map((s) => {
        const names = Array.from(
          new Set(
            (s.items || [])
              .map((i) => i.design_name || i.task_name)
              .filter((n): n is string => !!n)
          )
        )
        return {
          id: String(s.id),
          kind: "request" as const,
          label: names.length
            ? names.join(", ")
            : t("partner.payments.paidRequest"),
          amount: s.total_amount != null ? Number(s.total_amount) : null,
          currency_code: s.currency ?? null,
          created_at: s.paid_at || s.reviewed_at || s.submitted_at || s.created_at,
        }
      })
      .sort((a, b) => time(b.created_at) - time(a.created_at))
    const others: PaymentRow[] = (payments || []).map((p) => ({
      id: String(p.id),
      kind: "payment" as const,
      label: String(p.id),
      amount: typeof p.amount === "number" ? p.amount : null,
      currency_code: p.currency_code ?? null,
      created_at: p.created_at ?? null,
    }))
    return [...requests, ...others]
  }, [paidRequests, payments, t])

  const columnHelper = useMemo(() => createDataTableColumnHelper<PaymentMethodRow>(), [])
  const paymentsColumnHelper = useMemo(
    () => createDataTableColumnHelper<PaymentRow>(),
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("type", {
        header: () => t("partner.payments.columns.type"),
        cell: ({ getValue }) => {
          const v = String(getValue() || "-")
          if (v === "bank_account") return t("partner.payments.typeLabels.bankAccount")
          if (v === "cash_account") return t("partner.payments.typeLabels.cashAccount")
          if (v === "digital_wallet") return t("partner.payments.typeLabels.digitalWallet")
          return v || "-"
        },
      }),
      columnHelper.accessor("account_name", {
        header: () => t("partner.payments.columns.accountName"),
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor((row) => {
        return row.account_number || row.wallet_id || ""
      }, {
        id: "details",
        header: () => t("partner.payments.columns.details"),
        cell: ({ row }) => {
          const r = row.original
          if (r.type === "bank_account") {
            return (
              <div className="flex flex-col">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {r.bank_name || t("partner.payments.columns.bank")}
                </Text>
              </div>
            )
          }

          if (r.type === "digital_wallet") {
            return (
              <Text size="small">
                {t("partner.payments.columns.walletPrefix")}: {r.wallet_id || "-"}
              </Text>
            )
          }

          return <Text size="small">-</Text>
        },
      }),
      columnHelper.accessor("created_at", {
        header: () => t("partner.payments.columns.added"),
        cell: ({ getValue }) => {
          const v = getValue()
          if (!v) return "-"
          try {
            return new Date(String(v)).toLocaleDateString()
          } catch {
            return String(v)
          }
        },
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <PaymentMethodRowActions
            method={row.original}
            partnerId={partnerId}
          />
        ),
      }),
    ],
    [columnHelper, t, partnerId]
  )

  const paymentsColumns = useMemo(
    () => [
      paymentsColumnHelper.accessor("id", {
        header: () => t("partner.payments.columns.paymentId"),
        cell: ({ row }) => {
          const { label, kind } = row.original
          const createdAt = row.original.created_at
          const date = (() => {
            if (!createdAt) {
              return "-"
            }
            try {
              return new Date(String(createdAt)).toISOString().slice(0, 10)
            } catch {
              return "-"
            }
          })()

          return (
            <div className="flex flex-col">
              <Text weight="plus">{label}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {kind === "request"
                  ? t("partner.payments.paidOn", { date })
                  : date}
              </Text>
            </div>
          )
        },
      }),
      paymentsColumnHelper.accessor("amount", {
        header: () => t("partner.payments.columns.amount"),
        cell: ({ row }) => {
          const amount = row.original.amount
          const currency = (row.original.currency_code || "INR").toUpperCase()
          if (typeof amount !== "number") {
            return "—"
          }
          try {
            return getLocaleAmount(amount, currency)
          } catch {
            return `${amount} ${currency}`.trim()
          }
        },
      }),
      paymentsColumnHelper.accessor("currency_code", {
        header: () => t("partner.payments.columns.currency"),
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v).toUpperCase() : "—"
        },
      }),
    ],
    [paymentsColumnHelper, t]
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    enablePagination: true,
    count: rows.length,
    pageSize: 20,
  })

  const { table: paymentsTable } = useDataTable({
    data: paymentRows,
    columns: paymentsColumns,
    enablePagination: true,
    count: paymentRows.length,
    pageSize: 20,
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <div className="flex flex-col gap-y-3">
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Heading>{t("partner.payments.heading")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("partner.payments.subheading")}
              </Text>
            </div>
            <Button size="small" variant="secondary" asChild disabled={!partnerId}>
              <Link to="create">{t("partner.payments.create")}</Link>
            </Button>
          </div>

          <_DataTable
            columns={columns}
            table={table}
            pagination
            count={rows.length}
            isLoading={isMethodsLoading}
            pageSize={20}
            queryObject={{}}
            noRecords={{
              message: t("partner.payments.emptyMethods"),
            }}
          />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">{t("partner.payments.recentHeading")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.payments.recentDescription")}
            </Text>
          </div>

          <_DataTable
            columns={paymentsColumns}
            table={paymentsTable}
            pagination
            count={paymentRows.length}
            isLoading={isPaymentsLoading || (!!partnerId && isPaidLoading)}
            pageSize={20}
            queryObject={{}}
            navigateTo={(row) =>
              row.original.kind === "request"
                ? `/payment-submissions/${row.original.id}`
                : ""
            }
            noRecords={{
              message: t("partner.payments.emptyPayments"),
            }}
          />
        </Container>
      </div>
    </SingleColumnPage>
  )
}
