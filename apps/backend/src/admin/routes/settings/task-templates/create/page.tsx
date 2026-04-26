import { CreateTaskTemplateComponent } from "../../../../components/creates/create-task-template";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

const CreateTaskTemplateModal = () => {
  return (
    <RouteFocusModal>
      <CreateTaskTemplateComponent />
    </RouteFocusModal>
  );
};

export default CreateTaskTemplateModal;
