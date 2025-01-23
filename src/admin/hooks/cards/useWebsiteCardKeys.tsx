import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AdminWebsite } from "../api/websites";


export type CardKey = {
  key: keyof AdminWebsite | string;
  label: string;
  type?: "string" | "date" | "select" | "boolean";
  options?: { label: string; value: string }[];
  required?: boolean;
};

const excludeableFields = ["domain", "name", "status", "created_at", "updated_at"] as const;

export const useWebsiteCardKeys = (
  exclude?: (typeof excludeableFields)[number][],
) => {
  const { t } = useTranslation();

  const cardKeys = useMemo(() => {
    let keys: CardKey[] = [];

    // Domain
    if (!exclude?.includes("domain")) {
      keys.push({
        key: "domain",
        label: t("fields.domain", "Domain"),
        type: "string",
        required: true,
      });
    }

    // Name
    if (!exclude?.includes("name")) {
      keys.push({
        key: "name",
        label: t("fields.name", "Name"),
        type: "string",
        required: true,
      });
    }

    // Status
    if (!exclude?.includes("status")) {
      keys.push({
        key: "status",
        label: t("fields.status", "Status"),
        type: "select",
        options: [
          { label: "Active", value: "Active" },
          { label: "Inactive", value: "Inactive" },
          { label: "Maintenance", value: "Maintenance" },
          { label: "Development", value: "Development" },
        ],
      });
    }

    // Created At
    if (!exclude?.includes("created_at")) {
      keys.push({
        key: "created_at",
        label: t("fields.createdAt", "Created At"),
        type: "date",
      });
    }

    // Updated At
    if (!exclude?.includes("updated_at")) {
      keys.push({
        key: "updated_at",
        label: t("fields.updatedAt", "Updated At"),
        type: "date",
      });
    }

    return keys;
  }, [exclude, t]);

  return cardKeys;
};
