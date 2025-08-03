import { UIMatch, useParams } from "react-router-dom";
import { AgreementGeneralSection } from "../../../../components/agreements/agreement-general-section";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { useAgreement } from "../../../../hooks/api/agreement";

const AgreementDetailPage = () => {
  const { id } = useParams();
  const { agreement, isLoading } = useAgreement(id!);

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

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return id;
  },
};
