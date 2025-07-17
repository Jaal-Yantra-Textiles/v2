import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { EditContactForPersonForm } from "../../../../../components/persons/edit-contact-for-person";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { usePersonContacts } from "../../../../../hooks/api/person-contacts";
import { Spinner } from "../../../../../components/ui/ios-spinner";

const PersonContactEdit = () => {
  const { id, contactId } = useParams();
  const { t } = useTranslation();

  const { contacts, isPending, isError, error } = usePersonContacts(id!)

  if (isError) {
    throw error;
  }

  const contact = contacts?.find(c => c.id === contactId);

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("contact.edit.header", { defaultValue: "Edit Contact" })}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("contact.edit.description", { defaultValue: "Edit contact details" })}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {isPending && (
        <div className="flex h-full w-full items-center justify-center">
          <Spinner></Spinner>
        </div>
      )}
      {!isPending && contact && (
        <EditContactForPersonForm personId={id!} contact={contact} />
      )}
    </RouteDrawer>
  );
};

export default PersonContactEdit;

