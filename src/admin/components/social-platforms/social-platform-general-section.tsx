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
        toast.success(t("socialPlatform.toasts.deleted", "External Platform deleted"));
        navigate("/settings/external-platforms");
      } catch (e: any) {
        toast.error(e.message || t("errors.general", "An unexpected error occurred."));
      }
    }
  };

  const actionGroups = [
    {
      actions: [
        {
          label: t("actions.edit"),
          icon: <PencilSquare />,
          to: `edit`, // Relative path for editing
        },
      ],
    },
    {
      actions: [
        {
          label: t("Add Access"),
          icon: <CommandLineSolid />,
          to: `access`, // Relative path for access tokens
        },
      ],
    },
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: handleDelete,
          variant: "danger",
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
      label: "Category",
      value: platform.category || "-",
    },
    {
      label: "Authentication Type",
      value: platform.auth_type || "-",
    },
    {
      label: "Status",
      value: platform.status || "-",
    },
    {
      label: "Base URL",
      value: platform.base_url ? (
        <a href={platform.base_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          {platform.base_url}
        </a>
      ) : "-",
    },
    {
      label: "Icon URL",
      value: platform.icon_url ? (
        <a href={platform.icon_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          {platform.icon_url}
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
