import { useParams } from 'react-router-dom';
import { usePartner } from '../../../../../hooks/api/partners-admin';
import { Container, Text } from '@medusajs/ui';
import { useTranslation } from 'react-i18next';
import { RouteFocusModal } from '../../../../../components/modal/route-focus-modal';
import { PartnerTaskCanvasSection } from '../../../../../components/partners/partner-task-canvas-section';

const ViewPartnerTaskCanvas = () => {
  const { id } = useParams();
  const { partner, isPending: isLoading } = usePartner(
    id!,
    ['*', 'tasks.*', 'tasks.subtasks.*']
  ) as any;
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Container className="p-6">
        <Text>{t("Loading partner tasks...")}</Text>
      </Container>
    );
  }

  if (!partner) {
    return (
      <Container className="p-6">
        <Text>{t("Partner not found")}</Text>
      </Container>
    );
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex flex-col gap-y-1 sm:flex-row sm:items-center sm:gap-x-2">
          <Text size="large" weight="plus">
            <span className="break-words">{partner.name} - Task Canvas</span>
          </Text>
        </div>
      </RouteFocusModal.Header>
      <PartnerTaskCanvasSection partner={partner} />
    </RouteFocusModal>
  );
};

export default ViewPartnerTaskCanvas;
