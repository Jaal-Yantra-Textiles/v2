import { EditEmailTemplateContentSection } from "../../../../../components/edits/edit-email-template-content";
import { useEmailTemplate } from "../../../../../hooks/api/email-templates";
import { useParams } from "react-router-dom";

const EditEmailTemplateContent = () => {
    const { id } = useParams()
    const { emailTemplate } = useEmailTemplate(id!);
    
    if(!emailTemplate) {
        return null;
    }
    
    return <EditEmailTemplateContentSection emailTemplate={emailTemplate} />;
};

export default EditEmailTemplateContent;
