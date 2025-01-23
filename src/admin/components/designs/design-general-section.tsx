import { PencilSquare, Trash, Newspaper } from "@medusajs/icons";
import {
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign } from "../../hooks/api/designs";
import { useDeleteDesign } from "../../hooks/api/designs";


const designStatusColor = (status: string) => {
  switch (status) {
    case "draft":
      return "grey";
    case "in_progress":
      return "orange";
    case "completed":
      return "green";
    case "cancelled":
      return "red";
    case "conceptual":
      return "orange";
    default:
      return "grey";
  }
};

interface DesignGeneralSectionProps {
  design: AdminDesign;
}

export const DesignGeneralSection = ({ design }: DesignGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeleteDesign(design.id);

  const handleDelete = async () => {
    const res = await prompt({
      title: t("designs.delete.title"),
      description: t("designs.delete.description", {
        name: design.name,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: design.name,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    });

    if (!res) {
      return;
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(
          t("designs.delete.successToast", {
            name: design.name,
          }),
        );
        navigate("/designs", { replace: true });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading>{design.name}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          <StatusBadge color={designStatusColor(design.status as string)}>
            {design.status}
          </StatusBadge>

          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit"),
                    icon: <PencilSquare />,
                    to: "edit",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: 'Add Note',
                    icon: <Newspaper />,
                    to: "addnote",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.delete"),
                    icon: <Trash />,
                    onClick: handleDelete,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.description")}
        </Text>
        <Text size="small" leading="compact">
          {design.description || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("Design Type")}
        </Text>
        <Text size="small" leading="compact">
          {design.design_type || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("Inspiration Sources")}
        </Text>
        <Text size="small" leading="compact">
          {design.inspiration_sources?.join(", ") || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("Target Date")}
        </Text>
        <Text size="small" leading="compact">
          {new Date(design.target_completion_date).toLocaleString() || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.createdAt")}
        </Text>
        <Text size="small" leading="compact">
          {new Date(design.created_at as Date).toLocaleString() || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.updatedAt")}
        </Text>
        <Text size="small" leading="compact">
          {new Date(design.updated_at as Date).toLocaleString() || "-"}
        </Text>
      </div>
    </Container>
  );
};
