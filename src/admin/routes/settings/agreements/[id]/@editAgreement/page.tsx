import { EditAgreementContentSection } from "../../../../../components/edits/edit-agreement-conten";
import { useAgreement } from "../../../../../hooks/api/agreement";
import { useParams } from "react-router-dom";

const EditAgreementContent = () => {
    const { id } = useParams()
    const { agreement } = useAgreement(id!);
    if(!agreement) {
        return null;
    }
  return <EditAgreementContentSection agreement={agreement} />;
};

export default EditAgreementContent;
