import { CreateEmailTemplateSteps } from "../../../../components/creates/create-email-template-steps";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

const CreateEmailTemplatePage = () => {
  return <RouteFocusModal>  
    <CreateEmailTemplateSteps />
  </RouteFocusModal>
};

export default CreateEmailTemplatePage;
