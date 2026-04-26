import { useTranslation } from "react-i18next";
import { Filter } from "../../components/table/data-table-filter";

// export type Filter = {
//   key: string;
//   label: string;
//   type: "select" | "date" | "text";
//   options?: {
//     label: string;
//     value: string;
//   }[];
//   multiple?: boolean;
// };

const excludeableFields = ["date_of_birth", "email"] as const;

export const usePersonTableFilters = (
  exclude?: (typeof excludeableFields)[number][],
) => {
  const { t } = useTranslation();
  let filters: Filter[] = [];

  // Email filter
  if (!exclude?.includes("email")) {
    const emailFilter: Filter = {
      key: "email",
      label: t("fields.email", "Email"),
      type: "string",
    };
    filters = [...filters, emailFilter];
  }

  // Date of birth filter
  if (!exclude?.includes("date_of_birth")) {
    const dobFilter: Filter = {
      key: "date_of_birth",
      label: t("fields.dateOfBirth", "Date of Birth"),
      type: "date",
    };
    filters = [...filters, dobFilter];
  }

  // Created and Updated date filters
  const dateFilters: Filter[] = [
    {
      label: t("fields.createdAt", "Created At"),
      key: "created_at",
    },
    {
      label: t("fields.updatedAt", "Updated At"),
      key: "updated_at",
    },
  ].map((f) => ({
    key: f.key,
    label: f.label,
    type: "date",
  }));

  filters = [...filters, ...dateFilters];

  return filters;
};
