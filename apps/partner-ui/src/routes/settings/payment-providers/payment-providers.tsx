import { Trash } from "@medusajs/icons"
import {
  Container,
  createDataTableColumnHelper,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Outlet } from "react-router-dom"

import { DataTable } from "../../../components/data-table"
import {
  usePaymentConfigs,
  useDeletePaymentConfig,
  type PaymentConfig,
} from "../../../hooks/api/payment-config"

const PROVIDER_LABELS: Record<string, string> = {
  pp_payu_payu: "PayU",
  pp_stripe_stripe: "Stripe",
}

const PAGE_SIZE = 20

export const PaymentProvidersPage = () => {
  const { t } = useTranslation()
  const { payment_configs, isPending } = usePaymentConfigs()

  const columns = useColumns()

  return (
    <>
      <Container className="divide-y px-0 py-0">
        <DataTable
          data={payment_configs}
          columns={columns}
          rowCount={payment_configs.length}
          pageSize={PAGE_SIZE}
          getRowId={(row) => row.id}
          heading={t("partner.paymentProviders.heading")}
          subHeading={t("partner.paymentProviders.subHeading")}
          emptyState={{
            empty: {
              heading: t("partner.paymentProviders.empty.heading"),
              description: t("partner.paymentProviders.empty.description"),
            },
            filtered: {
              heading: t("general.noRecordsMessage"),
              description: t("general.noRecordsMessageFiltered"),
            },
          }}
          actions={[
            {
              label: t("actions.create"),
              to: "create",
            },
          ]}
          isLoading={isPending}
        />
      </Container>
      <Outlet />
    </>
  )
}

const columnHelper = createDataTableColumnHelper<PaymentConfig>()

const useColumns = () => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const { mutateAsync: deleteConfig } = useDeletePaymentConfig()

  const handleDelete = useCallback(
    async (config: PaymentConfig) => {
      const providerName =
        PROVIDER_LABELS[config.provider_id] || config.provider_id

      const confirmed = await prompt({
        title: t("general.areYouSure"),
        description: t("partner.paymentProviders.removePrompt.description", {
          provider: providerName,
        }),
        confirmText: t("actions.delete"),
        cancelText: t("actions.cancel"),
      })

      if (!confirmed) return

      await deleteConfig(config.id, {
        onSuccess: () => toast.success(t("partner.paymentProviders.toast.removed")),
        onError: (e) =>
          toast.error(e.message || t("partner.paymentProviders.toast.removeFailed")),
      })
    },
    [t, prompt, deleteConfig]
  )

  return useMemo(
    () => [
      columnHelper.accessor("provider_id", {
        header: t("partner.paymentProviders.columns.provider"),
        cell: ({ getValue }) => {
          const id = getValue()
          return PROVIDER_LABELS[id] || id
        },
      }),
      columnHelper.accessor("is_active", {
        header: t("partner.paymentProviders.columns.status"),
        cell: ({ getValue }) =>
          getValue()
            ? t("partner.paymentProviders.columns.statusActive")
            : t("partner.paymentProviders.columns.statusInactive"),
      }),
      columnHelper.accessor("credentials", {
        header: t("partner.paymentProviders.columns.credentials"),
        cell: ({ getValue }) => {
          const creds = getValue()
          if (!creds) return "—"
          return Object.entries(creds)
            .map(([key, val]) => `${key}: ${val}`)
            .join(", ")
        },
      }),
      columnHelper.accessor("created_at", {
        header: t("partner.paymentProviders.columns.added"),
        cell: ({ getValue }) => {
          const date = getValue()
          if (!date) return "—"
          return new Date(date).toLocaleDateString()
        },
      }),
      columnHelper.action({
        actions: (ctx) => [
          [
            {
              icon: <Trash />,
              label: t("actions.delete"),
              onClick: () => handleDelete(ctx.row.original),
            },
          ],
        ],
      }),
    ],
    [handleDelete, t]
  )
}
