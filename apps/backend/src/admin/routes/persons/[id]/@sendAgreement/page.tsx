import { Heading } from "@medusajs/ui";
import { useParams } from "react-router-dom";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { SendAgreementToPersonForm } from "../../../../components/persons/send-agreement-to-person";
import { usePerson } from "../../../../hooks/api/persons";

export default function SendAgreementPage() {
  const { id } = useParams();
  
  if (!id) {
    return null;
  }

  const { person, isLoading } = usePerson(id);

  if (isLoading) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <RouteDrawer.Title asChild>
            <Heading>Send Agreement</Heading>
          </RouteDrawer.Title>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <div className="flex items-center justify-center p-8">
            Loading person details...
          </div>
        </RouteDrawer.Body>
      </RouteDrawer>
    );
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Send Agreement to {person?.first_name}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Send an agreement email to {person?.first_name} using an email template
        </RouteDrawer.Description>
      </RouteDrawer.Header>

      <SendAgreementToPersonForm 
        personId={id} 
        personName={person?.first_name} 
      />
    </RouteDrawer>
  );
}
