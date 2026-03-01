import { useParams } from 'react-router-dom';
import { useDesign } from '../../../../hooks/api/designs';
import { useProductionRuns } from '../../../../hooks/api/production-runs';
import { DesignTaskCanvasSection } from '../../../../components/designs/design-task-canvas-section';
import { Container, Text } from '@medusajs/ui';
import { useTranslation } from 'react-i18next';
import { RouteFocusModal } from '../../../../components/modal/route-focus-modal';


const ViewCanvasBasedTasks = () => {
  const { id } = useParams();
  const { design, isLoading } = useDesign(id!, {
    fields: ['+tasks.*', '+tasks.subtasks.*']
  });
  const { production_runs, isLoading: isRunsLoading } = useProductionRuns(
    { design_id: id, limit: 50, offset: 0, include_tasks: "true" },
  );
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <Container className="p-6">
        <Text>{t("Loading task canvas...")}</Text>
      </Container>
    );
  }

  if (!design) {
    return (
      <Container className="p-6">
        <Text>{t("Design not found")}</Text>
      </Container>
    );
  }

  return (
    <RouteFocusModal>
       <RouteFocusModal.Header></RouteFocusModal.Header>
        <DesignTaskCanvasSection
          design={design}
          productionRuns={!isRunsLoading ? production_runs : undefined}
        />
    </RouteFocusModal>

  );
};

export default ViewCanvasBasedTasks;
