import {  UIMatch, useParams } from "react-router-dom";
import { usePerson } from "../../../hooks/api/persons";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { PersonGeneralSection } from "../../../components/persons/person-general-section";
import { PersonsAddressSection } from "../../../components/persons/persons-address-section";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";
import { PersonContactSection } from "../../../components/persons/person-contact-sections";
import { PersonTagsComponent } from "../../../components/persons/person-tags-component";
import { PersonTypesComponent } from "../../../components/persons/person-types-component";
import { PersonPartnerComponent } from "../../../components/persons/person-partner-component";
import { PersonAgreementsSection } from "../../../components/persons/person-agreements-section";

const PersonDetailPage = () => {
  
  const { id } = useParams();
  const { person, isLoading, isError, error } = usePerson(id!, {
    fields: "addresses.*, person_type.*, partner.*, contact_details.*, tags.*, agreements.*, agreements.responses.*"
  });

  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={3} showJSON showMetadata />;
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
      <PersonPartnerComponent person={person} />
      <PersonAgreementsSection person={person} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <PersonContactSection person={person} />
        <PersonTagsComponent person={person} />
        <PersonTypesComponent personTypes={person.person_type} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};

export default PersonDetailPage;
