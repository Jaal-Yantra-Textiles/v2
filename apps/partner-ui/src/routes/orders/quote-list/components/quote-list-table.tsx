import { Container, StatusBadge, createDataTableColumnHelper } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "../../../../components/data-table"
import { useQueryParams } from "../../../../hooks/use-query-params"
import { getLocaleAmount } from "../../../../lib/money-amount-helpers"
import {
  PartnerQuote,
  usePartnerQuotes,
} from "../../../../hooks/api/partner-quotes"

const PAGE_SIZE = 20

const columnHelper = createDataTableColumnHelper<PartnerQuote>()

/**
 * A quote is expired when its own `expires_at` has passed. Core enforces this
 * natively on the minted price list (`ends_at`), so this is presentation only —
 * the buyer's prices stop applying whether or not this badge renders.
 */
const isExpired = (quote: PartnerQuote) =>
  !!quote.expires_at && new Date(quote.expires_at).getTime() < Date.now()

const useColumns = () => {
  const { t } = useTranslation()

  return useMemo(
    () => [
      columnHelper.accessor("recipient_company", {
        header: t("fields.company", "Company"),
        cell: ({ row }) => {
          const { recipient_company, recipient_name, email_sent_to } =
            row.original
          const primary = recipient_company || recipient_name
          return (
            <div className="flex flex-col">
              <span className="txt-compact-small-plus truncate">
                {primary || "—"}
              </span>
              {email_sent_to ? (
                <span className="text-ui-fg-subtle txt-compact-xsmall truncate">
                  {email_sent_to}
                </span>
              ) : null}
            </div>
          )
        },
      }),
      columnHelper.accessor("lines", {
        header: t("fields.items", "Items"),
        cell: ({ getValue }) => {
          const lines = getValue() ?? []
          const units = lines.reduce((sum, l) => sum + (l.quantity ?? 0), 0)
          return (
            <span className="txt-compact-small">
              {lines.length === 1
                ? `1 line · ${units} units`
                : `${lines.length} lines · ${units} units`}
            </span>
          )
        },
      }),
      columnHelper.accessor("quoted_landed_total", {
        header: t("fields.landedTotal", "Landed total"),
        cell: ({ row }) => {
          const { quoted_landed_total, currency_code } = row.original
          if (quoted_landed_total == null) {
            return <span className="text-ui-fg-muted">—</span>
          }
          return (
            <span className="txt-compact-small">
              {getLocaleAmount(Number(quoted_landed_total), currency_code)}
            </span>
          )
        },
      }),
      columnHelper.accessor("view_count", {
        header: t("fields.viewed", "Viewed"),
        cell: ({ row }) => {
          const { view_count, last_viewed_at } = row.original
          if (!view_count) {
            return <span className="text-ui-fg-muted">Not opened</span>
          }
          return (
            <div className="flex flex-col">
              <span className="txt-compact-small">
                {view_count === 1 ? "1 view" : `${view_count} views`}
              </span>
              {last_viewed_at ? (
                <span className="text-ui-fg-subtle txt-compact-xsmall">
                  {new Date(last_viewed_at).toLocaleDateString()}
                </span>
              ) : null}
            </div>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: t("fields.status", "Status"),
        cell: ({ row }) => {
          const quote = row.original
          if (quote.status === "revoked") {
            return <StatusBadge color="red">Revoked</StatusBadge>
          }
          if (isExpired(quote)) {
            return <StatusBadge color="grey">Expired</StatusBadge>
          }
          return <StatusBadge color="green">Active</StatusBadge>
        },
      }),
      columnHelper.accessor("expires_at", {
        header: t("fields.expiresAt", "Expires"),
        cell: ({ getValue }) => {
          const value = getValue()
          return (
            <span className="txt-compact-small">
              {value ? new Date(value).toLocaleDateString() : "Never"}
            </span>
          )
        },
      }),
    ],
    [t]
  )
}

export const QuoteListTable = () => {
  const { t } = useTranslation()

  // DataTable owns pagination through the URL (`offset`); the list just reads
  // it back out, the same contract every other table here follows.
  const { offset } = useQueryParams(["offset"])

  const { quotes, count, isPending, isError, error } = usePartnerQuotes(
    {
      limit: PAGE_SIZE,
      offset: offset ? Number(offset) : 0,
    },
    { placeholderData: keepPreviousData }
  )

  const columns = useColumns()

  if (isError) {
    throw error
  }

  return (
    <Container className="p-0">
      <DataTable
        data={quotes}
        columns={columns}
        rowCount={count}
        getRowId={(row) => row.id}
        pageSize={PAGE_SIZE}
        isLoading={isPending}
        heading={t("quotes.domain", "Quotes")}
        subHeading={t(
          "quotes.subtitle",
          "Shareable B2B prices. A quote mints the buyer's own price list, so the number you send is the number their cart charges."
        )}
        action={{
          label: t("actions.create", "Create"),
          to: "/orders/quotes/create",
        }}
      />
    </Container>
  )
}
