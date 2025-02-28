import {   Outlet, UIMatch, useParams } from "react-router-dom";
import { usePerson } from "../../../hooks/api/persons";
import { SingleColumnPageSkeleton } from "../../../components/table/skeleton";
import { SingleColumnPage } from "../../../components/pages/single-column-pages";
import { PersonGeneralSection } from "../../../components/persons/person-general-section";
import { PersonsAddressSection } from "../../../components/persons/persons-address-section";





const PersonDetailPage = () => {
  
  const { id } = useParams();
  const { person, isLoading, isError, error } = usePerson(id!);

  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <SingleColumnPageSkeleton sections={2} showJSON showMetadata />;
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Handle case where person is undefined but not loading
  if (!person) {
    throw new Error("Person not found");
  }



  // Render main content when data is available
  return (
    
    <SingleColumnPage data={person} hasOutlet={true} showJSON showMetadata={true} >
      <PersonGeneralSection person={person} />
      <PersonsAddressSection person={person} />
    </SingleColumnPage>
  );
};

PersonDetailPage.handle = {
  breadcrumb: (match: UIMatch) => console.log('Working  ', match)
}

export default PersonDetailPage;
