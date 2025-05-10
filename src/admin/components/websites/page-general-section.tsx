import { PencilSquare, Trash } from "@medusajs/icons";
import {
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../common/action-menu";
import { AdminPage, useDeletePage } from "../../hooks/api/pages";
import { useNavigate } from "react-router-dom";

const pageStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "published":
      return "green";
    case "draft":
      return "orange";
    case "archived":
      return "red";
    default:
      return "grey";
  }
};

interface PageGeneralSectionProps {
  page: AdminPage;
  websiteId: string;
}

export const PageGeneralSection = ({ page, websiteId }: PageGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const { mutateAsync } = useDeletePage(websiteId, page.id);
  const navigate = useNavigate();
  const handleDelete = async () => {
    const res = await prompt({
      title: t("pages.delete.title", "Delete Page"),
      description: t("pages.delete.description", {
        name: page.title,
        defaultValue: `Are you sure you want to delete the page "${page.title}"?`
      }),
      verificationInstruction: t("general.typeToConfirm", "Type to confirm"),
      verificationText: page.title,
      confirmText: t("actions.delete", "Delete"),
      cancelText: t("actions.cancel", "Cancel"),
    });

    if (!res) {
      return;
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(
          t("pages.delete.successToast", {
            name: page.title,
          }),
        );
        navigate(`/websites/${websiteId}`, { replace: true });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading>{page.title}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          <StatusBadge color={pageStatusColor(page.status)}>
            {page.status}
          </StatusBadge>

          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit", "Edit"),
                    icon: <PencilSquare />,
                    to: `/websites/${websiteId}/pages/${page.id}/edit`,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.delete", "Delete"),
                    icon: <Trash />,
                    onClick: handleDelete,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.send", "Send to Subscribers"),
                    icon: <Trash />,
                    to: ``
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("pages.details.type", "Page Type")}
        </Text>
        <Text size="small" leading="compact">
          {page.page_type}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("pages.details.slug", "Slug")}
        </Text>
        <Text size="small" leading="compact">
          {page.slug || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("pages.details.lastModified", "Last Modified")}
        </Text>
        <Text size="small" leading="compact">
          {new Date(page.updated_at).toLocaleString()}
        </Text>
      </div>
      {(page.meta_title || page.meta_description || page.meta_keywords) && (
        <>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("pages.details.metaTitle", "Meta Title")}
            </Text>
            <Text size="small" leading="compact">
              {page.meta_title || "-"}
            </Text>
          </div>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("pages.details.metaDescription", "Meta Description")}
            </Text>
            <Text size="small" leading="compact">
              {page.meta_description || "-"}
            </Text>
          </div>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("pages.details.metaKeywords", "Meta Keywords")}
            </Text>
            <Text size="small" leading="compact">
              {page.meta_keywords || "-"}
            </Text>
          </div>
        </>
      )}
    </Container>
  );
};
