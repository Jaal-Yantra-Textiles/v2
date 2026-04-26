import { useTranslation } from "react-i18next";
import { Filter } from "../../components/table/data-table-filter";

const excludeableFields = ["priority", "category"] as const;

export const useTaskTemplatesTableFilters = (
  exclude?: (typeof excludeableFields)[number][],
) => {
  const { t } = useTranslation();
  let filters: Filter[] = [];

  // Priority filter
  if (!exclude?.includes("priority")) {
    const priorityFilter: Filter = {
      key: "priority",
      label: t("fields.priority", "Priority"),
      type: "select",
      options: [
        { label: "Low", value: "low" },
        { label: "Medium", value: "medium" },
        { label: "High", value: "high" },
      ],
    };
    filters = [...filters, priorityFilter];
  }

  // Category filter
  if (!exclude?.includes("category")) {
    const categoryFilter: Filter = {
      key: "category",
      label: t("fields.category", "Category"),
      type: "string",
    };
    filters = [...filters, categoryFilter];
  }

  // Created and Updated date filters
  const dateFilters: Filter[] = [
    {
      label: t("fields.createdAt", "Created At"),
      key: "created_at",
      type: "date",
    },
    {
      label: t("fields.updatedAt", "Updated At"),
      key: "updated_at",
      type: "date",
    },
  ];

  return [...filters, ...dateFilters];
};
