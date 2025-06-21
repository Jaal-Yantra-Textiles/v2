import { CommandLineSolid, PencilSquare, Trash } from "@medusajs/icons";
import { useTranslation } from "react-i18next";
import { AdminSocialPlatform } from "../../hooks/api/social-platforms"; // Path based on typical structure
import { CommonSection, CommonField } from "../common/section-views"; // Assumed path
import { usePrompt, toast } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { useDeleteSocialPlatform } from "../../hooks/api/social-platforms";

// Assuming CommonField and CommonSection props based on TaskTemplateGeneralSection
// If these are incorrect, please provide the correct definitions or path.

export const SocialPlatformGeneralSection = ({ platform }: { platform: AdminSocialPlatform }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prompt = usePrompt();
  const { mutateAsync: deletePlatform } = useDeleteSocialPlatform(platform.id);

  const handleDelete = async () => {
    const confirmation = await prompt({
      title: t("socialPlatform.delete.title", "Delete Social Platform?"),
      description: t(
        "socialPlatform.delete.description",
        "Are you sure you want to delete this social platform? This action cannot be undone."
      ),
      confirmText: t("actions.delete", "Delete"),
      cancelText: t("actions.cancel", "Cancel"),
    });

    if (confirmation) {
      try {
        await deletePlatform();
        toast.success(t("socialPlatform.toasts.deleted", "Social Platform deleted"));
        navigate("/settings/social-platforms");
      } catch (e: any) {
        toast.error(e.message || t("errors.general", "An unexpected error occurred."));
      }
    }
  };

  const actionGroups = [
    {
      actions: [
        {
          label: t("Add Access"),
          icon: <CommandLineSolid />,
          to: `access`, // Relative path for editing
        },
      ],
    },
    {
        actions: [
          {
            label: t("actions.edit"),
            icon: <PencilSquare />,
            to: `Add Access Token`, // Relative path for editing
          },
        ],
      },
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: handleDelete,
          variant: "danger", // Assuming CommonSection supports a danger variant for buttons
        },
      ],
    },
  ];

  const generalFields: CommonField[] = [
    {
      label: t("fields.name", "Name"),
      value: platform.name,
    },
    {
      label: t("fields.description", "Description"),
      value: platform.description || "-",
    },
    {
      label: t("fields.url", "URL"),
      value: platform.url ? (
        <a href={platform.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          {platform.url}
        </a>
      ) : "-",
    },
  ];

  return (
    <CommonSection
      title={t("socialPlatform.general.title", "General Information")}
      description={t("socialPlatform.general.description", "Basic details of the social platform.")}
      fields={generalFields}
      actionGroups={actionGroups}
    />
  );
};
