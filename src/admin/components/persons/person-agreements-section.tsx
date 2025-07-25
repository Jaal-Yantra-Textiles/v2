import { Link } from "react-router-dom";
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui";
import { Eye, Plus } from "@medusajs/icons";

type PersonAgreementsSectionProps = {
  person: any;
};

export const PersonAgreementsSection = ({ person }: PersonAgreementsSectionProps) => {
  const agreements = person?.agreements || [];
  const totalSent = agreements.reduce((sum: number, agreement: any) => sum + (agreement.sent_count || 0), 0);
  const totalResponses = agreements.reduce((sum: number, agreement: any) => sum + (agreement.response_count || 0), 0);
  const totalAgreed = agreements.reduce((sum: number, agreement: any) => sum + (agreement.agreed_count || 0), 0);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Agreements</Heading>
          <Badge size="2xsmall" className="ml-2">
            {agreements.length}
          </Badge>
        </div>
        <div className="flex items-center gap-x-2">
          <Link to={`/persons/${person.id}/showAgreements`}>
            <Button size="small" variant="secondary">
              <Eye className="mr-1" />
              View All
            </Button>
          </Link>
          <Link to={`/persons/${person.id}/sendAgreement`}>
            <Button size="small" variant="secondary">
              <Plus className="mr-1" />
              Send Agreement
            </Button>
          </Link>
        </div>
      </div>

      <div className="px-6 py-4">
        {agreements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Text className="text-ui-fg-muted">No agreements found</Text>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              This person has no agreements yet.
            </Text>
            <div className="mt-4">
              <Link to={`/persons/${person.id}/sendAgreement`}>
                <Button size="small">
                  <Plus className="mr-1" />
                  Send First Agreement
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {agreements.length}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Total
                </Text>
              </div>
              <div className="text-center p-3 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {totalSent}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Sent
                </Text>
              </div>
              <div className="text-center p-3 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {totalResponses}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Responses
                </Text>
              </div>
              <div className="text-center p-3 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {totalAgreed}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Agreed
                </Text>
              </div>
            </div>

            {/* Recent Agreements */}
            <div>
              <Text size="small" weight="plus" className="text-ui-fg-base mb-3">
                Recent Agreements
              </Text>
              <div className="space-y-2">
                {agreements.slice(0, 3).map((agreement: any) => (
                  <div key={agreement.id} className="flex items-center justify-between p-3 border border-ui-border-base rounded-lg">
                    <div className="flex items-center gap-3">
                      <div>
                        <Text size="small" weight="plus">
                          {agreement.title}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {agreement.subject || 'No subject'}
                        </Text>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        size="2xsmall" 
                        color={
                          agreement.status === 'active' ? 'green' : 
                          agreement.status === 'draft' ? 'grey' : 
                          agreement.status === 'expired' ? 'orange' : 'red'
                        }
                      >
                        {agreement.status}
                      </Badge>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {agreement.sent_count} sent
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
              
              {agreements.length > 3 && (
                <div className="mt-3 text-center">
                  <Link to={`/persons/${person.id}/showAgreements`}>
                    <Button size="small" variant="transparent">
                      View {agreements.length - 3} more agreements
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Container>
  );
};
