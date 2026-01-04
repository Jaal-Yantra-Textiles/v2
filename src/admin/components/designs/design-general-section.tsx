import { PencilSquare, Trash, Newspaper, BookOpen, Link } from "@medusajs/icons";
import {
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
  Badge,
  Tooltip,
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
        toast.success('Design deleted successfully'),
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
                  {
                    label: "Create Production Run",
                    icon: <Newspaper />,
                    to: "production-run",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: 'Edit Note',
                    icon: <Newspaper />,
                    to: "addnote",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: 'Edit Moodboard',
                    icon: <BookOpen />,
                    to: "moodboard",
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
        <div className="divide-y">
          {/* Description */}
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
              {t("fields.status")}
            </Text>
            <StatusBadge color={designStatusColor(design.status as string)}>
            {design.status}
          </StatusBadge>
          </div>

          {/* Design Type */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("Design Type")}
            </Text>
            <Text size="small" leading="compact">
              {design.design_type || "-"}
            </Text>
          </div>

          {/* Inspiration Sources */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("Inspiration Sources")}
            </Text>
            <Text size="small" leading="compact">
              {design.inspiration_sources?.map((source, index) => {
                // Check if the source is a URL
                const isUrl = source.match(/^(https?:\/\/|www\.)/i);
                
                if (isUrl) {
                  // Extract domain name for display
                  let displayUrl = source;
                  try {
                    // Remove protocol and get just domain
                    displayUrl = source.replace(/^(https?:\/\/|www\.)/i, '');
                    // Get domain part only
                    const domainParts = displayUrl.split('/');
                    displayUrl = domainParts[0];
                    // If still too long, truncate
                    if (displayUrl.length > 20) {
                      displayUrl = displayUrl.substring(0, 17) + '...';
                    }
                  } catch (e) {
                    // Fallback if parsing fails
                    displayUrl = source.length > 20 ? source.substring(0, 17) + '...' : source;
                  }
                  
                  // Ensure URL has proper protocol
                  const fullUrl = source.startsWith('http') ? source : `https://${source}`;
                  
                  // Create a shortened version for the tooltip if needed
                  const tooltipContent = source.length > 60 
                    ? source.substring(0, 57) + '...' 
                    : source;
                    
                  return (
                    <Tooltip key={index} content={<div className="max-w-[300px] break-all">{tooltipContent}</div>}>
                      <div className="inline-block">
                        <Badge 
                          key={index} 
                          className="mr-2 mb-1 cursor-pointer inline-flex items-center gap-1"
                          onClick={() => window.open(fullUrl, '_blank')}
                        >
                          <Link className="w-3 h-3 inline-flex" />
                          <span className="truncate max-w-[120px]">{displayUrl}</span>
                        </Badge>
                      </div>
                    </Tooltip>
                  );
                }
                
                // Regular tag
                return (
                  <Badge key={index} className="mr-2 mb-1">
                    {source}
                  </Badge>
                );
              }) || "-"}
            </Text>
          </div>

          {/* Target Date */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("Target Date")}
            </Text>
            <Text size="small" leading="compact">
              {new Date(design.target_completion_date).toLocaleString() || "-"}
            </Text>
          </div>


          {/* Estimated Cost */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Estimated Cost
            </Text>
            <Text size="small" leading="compact">
              {design.estimated_cost ? `$${design.estimated_cost}` : "-"}
            </Text>
          </div>
      

          {/* Created At */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.createdAt")}
            </Text>
            <Text size="small" leading="compact">
              {new Date(design.created_at as Date).toLocaleString() || "-"}
            </Text>
          </div>

          {/* Updated At */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.updatedAt")}
            </Text>
            <Text size="small" leading="compact">
              {new Date(design.updated_at as Date).toLocaleString() || "-"}
            </Text>
          </div>
        </div>
      </div>
    </Container>
  );
};
