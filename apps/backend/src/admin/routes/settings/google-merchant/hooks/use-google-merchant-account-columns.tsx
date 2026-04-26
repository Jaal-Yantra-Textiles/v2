import { createDataTableColumnHelper, StatusBadge } from "@medusajs/ui"
import { useMemo } from "react"
import { GoogleMerchantAccount } from "../../../../hooks/api/google-merchant"

const columnHelper = createDataTableColumnHelper<GoogleMerchantAccount>()

export const useGoogleMerchantAccountColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue(),
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("merchant_id", {
        header: "Merchant ID",
        cell: (info) => info.getValue(),
        enableSorting: true,
        sortLabel: "Merchant ID",
        sortAscLabel: "0 → 9",
        sortDescLabel: "9 → 0",
      }),
      columnHelper.accessor("account_email", {
        header: "Email",
        cell: (info) => info.getValue() || "—",
        enableSorting: true,
        sortLabel: "Email",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("connected", {
        header: "Status",
        cell: (info) => (
          <StatusBadge color={info.getValue() ? "green" : "orange"}>
            {info.getValue() ? "Connected" : "Not connected"}
          </StatusBadge>
        ),
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: (info) => new Date(info.getValue()).toLocaleDateString(),
        enableSorting: true,
        sortLabel: "Created",
        sortAscLabel: "Oldest first",
        sortDescLabel: "Newest first",
      }),
    ],
    []
  )
}
