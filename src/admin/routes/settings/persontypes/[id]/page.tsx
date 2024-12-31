import { useLoaderData, useParams } from "react-router-dom";
import { usePersonType } from "../../../../hooks/api/persontype";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { PersonTypeGeneralSection } from "../../../../components/person-type/person-type-general-section";
import { personTypeLoader } from "../../../../components/person-type/loader";

const PersonTypeDetail = () => {
  const { id } = useParams();

  const initialData = useLoaderData() as Awaited<
    ReturnType<typeof personTypeLoader>
  >;

  const { personType, isPending, isError, error } = usePersonType(
    id!,
    undefined,
    {
      initialData,
    },
  );

  if (isPending || !personType) {
    return <SingleColumnPageSkeleton sections={2} showJSON showMetadata />;
  }

  if (isError) {
    throw error;
  }

  return (
    <SingleColumnPage showJSON showMetadata data={personType}>
      <PersonTypeGeneralSection personType={personType} />
    </SingleColumnPage>
  );
};

export default PersonTypeDetail;
