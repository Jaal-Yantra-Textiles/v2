import { createDataTableColumnHelper } from "@medusajs/ui";
import { useMemo } from "react";
import { AdminPersonType } from "../../../../hooks/api/personandtype";
import { useTranslation } from "react-i18next";

const columnHelper = createDataTableColumnHelper<AdminPersonType>();

export const usePersonTypeTableColumns = () => {
  const { t } = useTranslation();
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("Name"),
        cell: (info) => info.getValue(),
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("description", {
        header: t("Description"),
        cell: (info) => info.getValue(),
      }),
    ],
    [t]
  );

  return columns;
};
