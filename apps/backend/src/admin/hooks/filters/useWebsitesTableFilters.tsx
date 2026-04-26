import { useTranslation } from "react-i18next";
import { Filter } from "../../components/table/data-table-filter";

const excludeableFields = ["domain", "name", "status"] as const;

export const useWebsitesTableFilters = (
  exclude?: (typeof excludeableFields)[number][],
) => {
  const { t } = useTranslation();
  let filters: Filter[] = [];

  // Domain filter
  if (!exclude?.includes("domain")) {
    const domainFilter: Filter = {
      key: "domain",
      label: t("fields.domain", "Domain"),
      type: "string",
    };
    filters = [...filters, domainFilter];
  }

  // Name filter
  if (!exclude?.includes("name")) {
    const nameFilter: Filter = {
      key: "name",
      label: t("fields.name", "Name"),
      type: "string",
    };
    filters = [...filters, nameFilter];
  }

  // Status filter
  if (!exclude?.includes("status")) {
    const statusFilter: Filter = {
      key: "status",
      label: t("fields.status", "Status"),
      type: "select",
      options: [
        { label: "Active", value: "Active" },
        { label: "Inactive", value: "Inactive" },
        { label: "Maintenance", value: "Maintenance" },
        { label: "Development", value: "Development" },
      ],
    };
    filters = [...filters, statusFilter];
  }

  return filters;
};
