import {  UIMatch, useParams } from "react-router-dom";
import { usePerson } from "../../../hooks/api/persons";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { PersonGeneralSection } from "../../../components/persons/person-general-section";
import { PersonsAddressSection } from "../../../components/persons/persons-address-section";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";

const PersonDetailPage = () => {
  
  const { id } = useParams();
  const { person, isLoading, isError, error } = usePerson(id!, {
    fields: ["addresses", "person_type.*", "partner.*"]
  });

  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={2} showJSON showMetadata />;
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
    
    <TwoColumnPage data={person} hasOutlet={true} showJSON showMetadata={true} >
      <TwoColumnPage.Main>
      <PersonGeneralSection person={person} />
      <PersonsAddressSection person={person} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

PersonDetailPage.handle = {
  breadcrumb: (match: UIMatch) => console.log('Working  ', match)
}

export default PersonDetailPage;
