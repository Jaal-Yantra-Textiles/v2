import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminPersonType } from "../../../../hooks/api/personandtype";
import { useTranslation } from "react-i18next";

const columnHelper = createColumnHelper<AdminPersonType>();

export const usePersonTypeTableColumns = () => {
  const { t } = useTranslation();
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("Name"),
        cell: (info) => info.getValue(),
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
