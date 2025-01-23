import { Plus } from "@medusajs/icons";
import { Container, Heading } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { useTranslation } from "react-i18next";

interface DesignTasksSectionProps {
  design: AdminDesign;
}

export const DesignTasksSection = ({ design }: DesignTasksSectionProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Tasks</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: t("Add Task"),
                  icon: <Plus />,
                  onClick: () => navigate(`/designs/${design.id}/tasks/new`),
                },
                {
                  label: t("Add From Template"),
                  icon: <Plus />,
                  onClick: () => navigate(`/designs/${design.id}/tasks/template/new`),
                },
              ],
            },
          ]}
        />
      </div>
      <div className="mt-4">
        {/* <TasksList designId={design.id} /> */}
      </div>
    </Container>
  );
};
