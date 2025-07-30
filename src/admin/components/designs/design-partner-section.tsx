import { Container, Heading, Text, Avatar } from "@medusajs/ui";
import { Plus, TriangleRightMini } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign } from "../../hooks/api/designs";
import { AdminPartner } from "../../hooks/api/partners";  
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";

interface DesignPartnerSectionProps {
  design: AdminDesign & { partners?: AdminPartner[] };
}

export const DesignPartnerSection = ({ design }: DesignPartnerSectionProps) => {
  const navigate = useNavigate();
  const partners = design.partners || [];
  
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Partners</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Partners who can produce this design
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Link Partner",
                  icon: <Plus />,
                  onClick: () => {
                    navigate(`/designs/${design.id}/linkPartner`);
                  },
                },
              ],
            },
          ]}
        />
      </div>
      <div className="txt-small flex flex-col gap-2 px-1 pb-2">
        {!partners.length ? (
          <div className="flex items-center justify-center py-4 w-full">
            <Text className="text-ui-fg-subtle">No partners linked to this design</Text>
          </div>
        ) : (
          partners.map((partner) => {
            const link = `/partners/${partner.id}`;
            
            const Inner = (
              <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                <div className="flex items-center gap-3">
                  <Avatar src={partner.logo || undefined} fallback={partner.name?.charAt(0) || 'P'} />
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="text-ui-fg-base font-medium">
                      {partner.name || `Partner ${partner.id}`}
                    </span>
                    <span className="text-ui-fg-subtle truncate max-w-[150px] sm:max-w-[200px] md:max-w-full block">
                      {partner.handle || "-"}
                    </span>
                  </div>
                  <div className="size-7 flex items-center justify-center">
                    <TriangleRightMini className="text-ui-fg-muted" />
                  </div>
                </div>
              </div>
            );
            
            return (
              <Link
                to={link}
                key={partner.id}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                {Inner}
              </Link>
            );
          })
        )}
      </div>
    </Container>
  );
};
