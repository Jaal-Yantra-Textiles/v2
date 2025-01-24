import { CreateDesignTaskComponent } from "../../../../../components/creates/create-design-task";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";

const AddDesignsTasksPage = () => {
  return (
    <RouteFocusModal>
      <CreateDesignTaskComponent />
    </RouteFocusModal>
  );
};

export default AddDesignsTasksPage;