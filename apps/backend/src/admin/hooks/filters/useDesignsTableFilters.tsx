import { useTranslation } from "react-i18next";
import { Filter } from "../../components/table/data-table-filter";

const excludeableFields = ["design_type", "status", "priority", "tags"] as const;

export const useDesignsTableFilters = (
  exclude?: (typeof excludeableFields)[number][],
) => {
  const { t } = useTranslation();
  let filters: Filter[] = [];

  // Design Type filter
  if (!exclude?.includes("design_type")) {
    const designTypeFilter: Filter = {
      key: "design_type",
      label: t("fields.designType", "Design Type"),
      type: "select",
      options: [
        { label: "Original", value: "Original" },
        { label: "Derivative", value: "Derivative" },
        { label: "Custom", value: "Custom" },
        { label: "Collaboration", value: "Collaboration" },
      ],
    };
    filters = [...filters, designTypeFilter];
  }

  // Status filter
  if (!exclude?.includes("status")) {
    const statusFilter: Filter = {
      key: "status",
      label: t("fields.status", "Status"),
      type: "select",
      options: [
        { label: "Conceptual", value: "Conceptual" },
        { label: "In Development", value: "In_Development" },
        { label: "Technical Review", value: "Technical_Review" },
        { label: "Sample Production", value: "Sample_Production" },
        { label: "Revision", value: "Revision" },
        { label: "Approved", value: "Approved" },
        { label: "Rejected", value: "Rejected" },
        { label: "On Hold", value: "On_Hold" },
      ],
    };
    filters = [...filters, statusFilter];
  }

  // Priority filter
  if (!exclude?.includes("priority")) {
    const priorityFilter: Filter = {
      key: "priority",
      label: t("fields.priority", "Priority"),
      type: "select",
      options: [
        { label: "Low", value: "Low" },
        { label: "Medium", value: "Medium" },
        { label: "High", value: "High" },
        { label: "Urgent", value: "Urgent" },
      ],
    };
    filters = [...filters, priorityFilter];
  }

  // Tags filter
  if (!exclude?.includes("tags")) {
    const tagsFilter: Filter = {
      key: "tags",
      label: t("fields.tags", "Tags"),
      type: "string",
    };
    filters = [...filters, tagsFilter];
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
