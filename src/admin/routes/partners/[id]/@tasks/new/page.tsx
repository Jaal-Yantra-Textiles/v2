import { CreatePartnerTaskComponent } from "../../../../../components/creates/create-partner-task";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";

const AddPartnerTasksPage = () => {
  return (
    <RouteFocusModal>
      <CreatePartnerTaskComponent />
    </RouteFocusModal>
  );
};

export default AddPartnerTasksPage;
