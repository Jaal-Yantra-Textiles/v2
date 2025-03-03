import { PencilSquare, Trash, Newspaper } from "@medusajs/icons";
import {
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
  Tabs,
  Badge,
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

const priorityColor = (priority: string) => {
  switch (priority?.toLowerCase()) {
    case "high":
      return "red";
    case "medium":
      return "orange";
    case "low":
      return "blue";
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
          {design.priority && (
            <Badge color={priorityColor(design.priority)}>
              {design.priority}
            </Badge>
          )}
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

      <div className="pt-4">
        <Tabs defaultValue="general" className="w-full">
          <Tabs.List className="flex justify-center px-6 py-2 border-b border-ui-border-base">
            <Tabs.Trigger value="general" className="px-4 py-2 font-medium">General</Tabs.Trigger>
            <div className="mx-2 text-ui-fg-subtle flex items-center">|</div>
            <Tabs.Trigger value="specs" className="px-4 py-2 font-medium">Specifications</Tabs.Trigger>
            <div className="mx-2 text-ui-fg-subtle flex items-center">|</div>
            <Tabs.Trigger value="details" className="px-4 py-2 font-medium">Additional Details</Tabs.Trigger>
          </Tabs.List>
          
          <Tabs.Content value="general" className="p-0">
            <div className="divide-y">
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
                  {design.inspiration_sources?.map((source, index) => (
                    <Badge key={index} className="mr-2 mb-1">
                      {source}
                    </Badge>
                  )) || "-"}
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
            </div>
          </Tabs.Content>
          
          <Tabs.Content value="specs" className="p-0">
            <div className="divide-y">
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Tags
                </Text>
                <div>
                  {design.tags?.map((tag, index) => (
                    <Badge key={index} className="mr-2 mb-1" color="blue">
                      {tag}
                    </Badge>
                  )) || "-"}
                </div>
              </div>
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Color Palette
                </Text>
                <div className="flex flex-wrap gap-2">
                  {design.color_palette?.map((color, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full border border-ui-border-base" 
                        style={{ backgroundColor: color.code }}
                      />
                      <Text size="small">
                        {color.name}
                      </Text>
                    </div>
                  )) || "-"}
                </div>
              </div>
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Custom Sizes
                </Text>
                <div>
                  {design.custom_sizes && Object.entries(design.custom_sizes).map(([size, details], index) => (
                    <div key={index} className="mb-2">
                      <Badge color="purple" className="mb-1">{size}</Badge>
                      <Text size="small" className="ml-2">
                        {Object.entries(details).map(([key, value]) => (
                          `${key}: ${value}`
                        )).join(", ")}
                      </Text>
                    </div>
                  )) || "-"}
                </div>
              </div>
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Estimated Cost
                </Text>
                <Text size="small" leading="compact">
                  {design.estimated_cost ? `$${design.estimated_cost}` : "-"}
                </Text>
              </div>
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Design Files
                </Text>
                <div>
                  {design.design_files?.map((file, index) => (
                    <Text key={index} size="small" leading="compact" className="mb-1">
                      {file}
                    </Text>
                  )) || "-"}
                </div>
              </div>
            </div>
          </Tabs.Content>
          
          <Tabs.Content value="details" className="p-0">
            <div className="divide-y">
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Designer Notes
                </Text>
                <Text size="small" leading="compact">
                  {design.designer_notes || "-"}
                </Text>
              </div>
              {design.metadata && (
                <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                  <Text size="small" leading="compact" weight="plus">
                    Metadata
                  </Text>
                  <div>
                    {Object.entries(design.metadata).map(([key, value], index) => (
                      <div key={index} className="mb-1">
                        <Text size="small" leading="compact">
                          <span className="font-medium">{key}:</span> {value}
                        </Text>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </Container>
  );
};
