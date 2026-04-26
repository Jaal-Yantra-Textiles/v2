import { createDataTableFilterHelper } from "@medusajs/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AdminPersonType } from "../../../../hooks/api/personandtype";

const filterHelper = createDataTableFilterHelper<AdminPersonType>();

export const usePersonTypeTableFilters = (personTypes: AdminPersonType[] = []) => {
  const { t } = useTranslation();

  const filters = useMemo(() => {
    if (!personTypes) {
      return [];
    }

    const nameOptions = personTypes.map((pt) => ({
      label: pt.name,
      value: pt.name,
    }));

    return [
      filterHelper.accessor("name", {
        type: "select",
        label: t("fields.name"),
        options: nameOptions,
      }),
    ];
  }, [t, personTypes]);

  return filters;
};
