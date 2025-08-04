import { Container, Heading, Text } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { AdminPerson } from "../../hooks/api/personandtype";
import { Eye, PencilSquare } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { useNavigate } from "react-router-dom";
import { GeneralSectionSkeleton } from "../table/skeleton";

interface Partner {
  id: string;
  name: string;
  handle: string;
  logo: string | null;
  status: string;
  is_verified: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Update the AdminPerson interface to include partner property
interface PersonWithPartner extends AdminPerson {
  partner?: Partner;
}

type PersonPartnerComponentProps = {
  person: PersonWithPartner;
};

export const PersonPartnerComponent = ({ person }: PersonPartnerComponentProps) => {
  const { t } = useTranslation();
  
  // Access the partner from the person object
  const partner = person.partner;

  const navigate = useNavigate();
  
  if(!partner){
    return <GeneralSectionSkeleton rowCount={1} />
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">
          {t("sections.partner", "Partner")}
        </Heading>
        
        {partner && (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit", "Edit"),
                    icon: <PencilSquare />,
                    to: `edit-partner`,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.view", "View Partner"),
                    icon: <Eye />,
                    onClick: () => navigate(`/partners/${partner.id}`),
                  },
                ],
              },
            ]}
          />
        )}
      </div>
      
      {partner ? (
        // Display partner information using the same grid layout as person-general-section
        <>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.name", "Name")}
            </Text>
            <Text size="small" leading="compact">
              {partner.name || "-"}
            </Text>
          </div>
          
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.handle", "Handle")}
            </Text>
            <Text size="small" leading="compact">
              {partner.handle || "-"}
            </Text>
          </div>
          
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.status", "Status")}
            </Text>
            <Text size="small" leading="compact" className="capitalize">
              {partner.status || "-"}
            </Text>
          </div>
          
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.verified", "Verified")}
            </Text>
            <Text size="small" leading="compact">
              {partner.is_verified ? t("common.yes", "Yes") : t("common.no", "No")}
            </Text>
          </div>
          
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.createdAt", "Created At")}
            </Text>
            <Text size="small" leading="compact">
              {new Date(partner.created_at).toLocaleDateString()}
            </Text>
          </div>
        </>
      ) : (
        // Display a message when no partner exists
        <div className="text-ui-fg-subtle px-6 py-8 border-t border-ui-border-base text-center">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {t("messages.noPartner", "No Partner added for this person")}
          </Text>
        </div>
      )}
    </Container>
  );
};

export default PersonPartnerComponent;
