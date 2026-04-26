import { UIMatch, useParams, useLoaderData, LoaderFunctionArgs } from "react-router-dom";
import { EmailTemplateGeneralSection } from "../../../../components/email-templates/email-template-general-section";
import { useEmailTemplate } from "../../../../hooks/api/email-templates";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { emailTemplateLoader } from "./loader";

const EmailTemplateDetailPage = () => {
  const { id } = useParams();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof emailTemplateLoader>>;
  
  const { emailTemplate, isLoading, isError } = useEmailTemplate(id!, {
    initialData
  });

  if (isLoading || !emailTemplate) {
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />;
  }

  if (isError) {
    throw new Error("Failed to load email template");
  }

  return (
    <SingleColumnPage
      data={emailTemplate}
      hasOutlet
      showJSON
      showMetadata
    >
      <EmailTemplateGeneralSection emailTemplate={emailTemplate} />
    </SingleColumnPage>
  );
};

export default EmailTemplateDetailPage;

export async function loader({ params }: LoaderFunctionArgs) {
  return emailTemplateLoader({ params });
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return id;
  },
};
