import { CreateDesign } from "../../../components/designs/create-design";
import { RouteFocusModal } from "../../../components/modal/route-focus-modal";

const CreateDesignPage = () => {
  // Render the unified design component directly within RouteFocusModal
  return (
    <RouteFocusModal>
      <CreateDesign />
    </RouteFocusModal>
  );
}
export default CreateDesignPage;