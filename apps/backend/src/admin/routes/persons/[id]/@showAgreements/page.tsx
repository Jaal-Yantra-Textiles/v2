import { useParams } from "react-router-dom";
import { ShowAgreementsForm } from "../../../../components/persons/show-agreements";
import { usePerson } from "../../../../hooks/api/persons";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";

const ShowAgreementsPage = () => {
  const { id } = useParams();
  const { person } = usePerson(id!, {
    fields: "first_name,last_name"
  });

  const personName = person ? `${person.first_name} ${person.last_name}`.trim() : undefined;

  return <RouteDrawer><ShowAgreementsForm personId={id!} personName={personName} /></RouteDrawer>;
};

export default ShowAgreementsPage;
