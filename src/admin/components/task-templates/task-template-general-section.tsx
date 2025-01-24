import { PencilSquare, Trash } from "@medusajs/icons";
import { useTranslation } from "react-i18next";
import { AdminTaskTemplate } from "../../hooks/api/task-templates";
import { CommonSection, CommonField } from "../common/section-views";

const getPriorityBadgeColor = (priority: string): "green" | "red" | "orange" | "grey" => {
  switch (priority) {
    case "high":
      return "red";
    case "medium":
      return "orange";
    case "low":
      return "green";
    default:
      return "grey";
  }
};

export const TaskTemplateGeneralSection = ({ template }: { template: AdminTaskTemplate }) => {
  const { t } = useTranslation();

  const actionGroups = [
    {
      actions: [
        {
          label: t("actions.edit"),
          icon: <PencilSquare />,
          to: `/settings/task-templates/${template.id}/edit`,
        },
      ],
    },
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: () => {
            // Handle delete
          },
          disabled: true,
          disabledTooltip: "Cannot delete template that is in use",
        },
      ],
    },
  ];

  const generalFields: CommonField[] = [
    {
      label: t("fields.name"),
      value: template.name,
    },
    {
      label: t("fields.description"),
      value: template.description || "-",
    },
    {
      label: t("fields.estimatedDuration"),
      value: template.estimated_duration
        ? `${template.estimated_duration} minutes`
        : "-",
    },
    {
      label: t("fields.priority"),
      badge: {
        value: template.priority.charAt(0).toUpperCase() + template.priority.slice(1),
        color: getPriorityBadgeColor(template.priority),
      },
    },
    {
      label: t("fields.settings"),
      badges: [
        {
          value: template.eventable ? "Events Enabled" : "Events Disabled",
          color: template.eventable ? "green" : "grey",
        },
        {
          value: template.notifiable ? "Notifications Enabled" : "Notifications Disabled",
          color: template.notifiable ? "green" : "grey",
        },
      ],
    },
  ];

  return (
    <CommonSection
      title={t("taskTemplate.general")}
      description={t("taskTemplate.generalDescription")}
      fields={generalFields}
      actionGroups={actionGroups}
    />
  );
};
