import { EditAgreementContentSection } from "../../../../../components/edits/edit-agreement-conten";
import { useAgreement } from "../../../../../hooks/api/agreement";
import { useParams, useLoaderData } from "react-router-dom";
import { agreementLoader } from "../loader";

const EditAgreementContent = () => {
    const { id } = useParams();
    const initialData = useLoaderData() as Awaited<ReturnType<typeof agreementLoader>>;
    
    const { agreement } = useAgreement(id!, {
      initialData
    });
    
    if(!agreement) {
        return null;
    }
  return <EditAgreementContentSection agreement={agreement} />;
};

export default EditAgreementContent;
