import { AdminAgreement } from "../../hooks/api/agreement";
import { AgreementEditorSection } from "../agreements/agreement-editor-section";
import { RouteFocusModal } from "../modal/route-focus-modal";


export const EditAgreementContentSection = ({agreement}: {agreement: AdminAgreement}) => {
  return <RouteFocusModal>
    <AgreementEditorSection agreement={agreement} />
  </RouteFocusModal>;
};
