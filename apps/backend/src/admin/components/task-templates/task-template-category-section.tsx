import { useTranslation } from "react-i18next";
import { AdminTaskTemplate } from "../../hooks/api/task-templates";
import { CommonSection, EmptyStateSection, CommonField } from "../common/section-views";

export const TaskTemplateCategorySection = ({ template }: { template: AdminTaskTemplate }) => {
  const { t } = useTranslation();

  if (!template.category) {
    return (
      <EmptyStateSection
        title={t("taskTemplate.category")}
        description={t("taskTemplate.categoryDescription")}
        message={t("taskTemplate.noCategoryAssigned")}
      />
    );
  }

  const category = typeof template.category === "string"
    ? { name: template.category, description: undefined as string | undefined }
    : template.category as { name?: string; description?: string };

  const categoryFields: CommonField[] = [
    {
      label: t("fields.name"),
      value: category.name,
    },
    ...(category.description
      ? [
          {
            label: t("fields.description"),
            value: category.description,
          },
        ]
      : []),
  ];

  return (
    <CommonSection
      title={t("taskTemplate.category")}
      description={t("taskTemplate.categoryDescription")}
      fields={categoryFields}
    />
  );
};
