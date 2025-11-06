import { CreatePartnerTaskComponent } from "../../../../../components/creates/create-partner-task-with-tabs";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";

const AddPartnerTasksPage = () => {
  return (
    <RouteFocusModal>
      <CreatePartnerTaskComponent />
    </RouteFocusModal>
  );
};

export default AddPartnerTasksPage;
