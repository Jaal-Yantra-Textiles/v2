import { RouteFocusModal } from "../modal/route-focus-modal";
import { CreateAgreementSteps } from "./create-agreement-steps";

export const CreateAgreement = () => {
  return <RouteFocusModal>
    <CreateAgreementSteps />
  </RouteFocusModal>;
};
