import { UIMatch, useParams, useLoaderData, LoaderFunctionArgs } from "react-router-dom";
import { AgreementGeneralSection } from "../../../../components/agreements/agreement-general-section";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { useAgreement } from "../../../../hooks/api/agreement";
import { agreementLoader } from "./loader";

const AgreementDetailPage = () => {
  const { id } = useParams();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof agreementLoader>>;
  
  const { agreement, isLoading } = useAgreement(id!, {
    initialData
  });

  if (isLoading || !agreement) {
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />;
  }


  return (
    <SingleColumnPage
      data={agreement}
      hasOutlet
      showJSON
      showMetadata
    >
      <AgreementGeneralSection agreement={agreement} />

    </SingleColumnPage>
  );
};

export default AgreementDetailPage;

export async function loader({ params }: LoaderFunctionArgs) {
  return agreementLoader({ params });
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return id;
  },
};
