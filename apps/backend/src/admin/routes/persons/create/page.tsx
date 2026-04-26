import { CreatePersonComponent } from "../../../components/creates/create-person";

import { RouteFocusModal } from "../../../components/modal/route-focus-modal";

const CreatePersonModal = () => {
  return (
    <RouteFocusModal>
      <CreatePersonComponent />
    </RouteFocusModal>
  );
};

export default CreatePersonModal;
