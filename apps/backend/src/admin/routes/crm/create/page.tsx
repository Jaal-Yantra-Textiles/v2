import { CreateCrmPersonComponent } from "../../../components/creates/create-crm-person";
import { RouteFocusModal } from "../../../components/modal/route-focus-modal";

const CreateCrmPersonModal = () => {
  return (
    <RouteFocusModal>
      <CreateCrmPersonComponent />
    </RouteFocusModal>
  );
};

export default CreateCrmPersonModal;
