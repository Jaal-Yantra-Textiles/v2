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

  const categoryFields: CommonField[] = [
    {
      label: t("fields.name"),
      value: template.category.name,
    },
    ...(template.category.description
      ? [
          {
            label: t("fields.description"),
            value: template.category.description,
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
