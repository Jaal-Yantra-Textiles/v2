import {  LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom";
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
import { AdminPerson } from "../../../hooks/api/personandtype";
import { personLoader } from "./loader";

const PersonDetailPage = () => {
  const { id } = useParams();
  
  const initialData = useLoaderData() as Awaited<{ person: AdminPerson } >
  
  const { person, isPending: isLoading, isError, error } = usePerson(id!, {
    fields: "addresses.*, person_types.*, partner.*, contact_details.*, tags.*, agreements.*, agreements.responses.*"
  }, {
    initialData: initialData
  });

  // Show loading skeleton while data is being fetched
  if (isLoading || !person) {
    return (
    <TwoColumnPageSkeleton 
      mainSections={3} 
      sidebarSections={3} 
      showJSON 
      showMetadata 
      />
    );
  }

  // Handle error state
  if (isError) {
    throw error;
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
        <PersonTypesComponent personTypes={person.person_types} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

export async function loader({ params }: LoaderFunctionArgs) {
  return await personLoader({ params });
}


export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};

export default PersonDetailPage;
