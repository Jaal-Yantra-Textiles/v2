import { useParams } from 'react-router-dom';
import { useDesign } from '../../../../hooks/api/designs';
import { DesignTaskCanvasSection } from '../../../../components/designs/design-task-canvas-section';
import { Container, Text } from '@medusajs/ui';
import { useTranslation } from 'react-i18next';
import { RouteFocusModal } from '../../../../components/modal/route-focus-modal';


const ViewCanvasBasedTasks = () => {
  const { id } = useParams();
  const { design, isLoading } = useDesign(id!, {
    fields: ['+tasks.*', '+tasks.subtasks.*']
  });
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
    
        <DesignTaskCanvasSection design={design} />
        
  );
};

export default ViewCanvasBasedTasks;