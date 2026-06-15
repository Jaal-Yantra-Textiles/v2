import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"
import { ConfigurableDataTable } from "../../../../../components/table/configurable-data-table"
import { useOrderTableAdapter } from "./order-table-adapter"
import { deriveOrderKind, KIND_HEADINGS } from "./order-kind"

export const ConfigurableOrderListTable = () => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  // #342 — the configurable table is kind-aware: it filters server-side by which
  // unified link is present and surfaces a Work-status column for work-orders,
  // so every kind sub-route uses it under the `view_configurations` flag.
  const kind = deriveOrderKind(pathname)
  const orderAdapter = useOrderTableAdapter(kind)

  return (
    <ConfigurableDataTable
      adapter={orderAdapter}
      heading={kind === "retail" ? t("orders.domain") : KIND_HEADINGS[kind]}
      layout="fill"
    />
  )
}
