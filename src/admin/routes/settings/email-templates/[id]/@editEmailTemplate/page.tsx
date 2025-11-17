import { EditEmailTemplateContentSection } from "../../../../../components/edits/edit-email-template-content";
import { useEmailTemplate } from "../../../../../hooks/api/email-templates";
import { useParams, useLoaderData } from "react-router-dom";
import { emailTemplateLoader } from "../loader";

const EditEmailTemplateContent = () => {
    const { id } = useParams();
    const initialData = useLoaderData() as Awaited<ReturnType<typeof emailTemplateLoader>>;
    
    const { emailTemplate } = useEmailTemplate(id!, {
      initialData
    });
    
    if(!emailTemplate) {
        return null;
    }
    
    return <EditEmailTemplateContentSection emailTemplate={emailTemplate} />;
};

export default EditEmailTemplateContent;
