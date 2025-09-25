import { Link } from "react-router-dom";
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui";
import { Eye, Plus } from "@medusajs/icons";
import { usePersonAgreements } from "../../hooks/api/persons";

type PersonAgreementsSectionProps = {
  person: any;
};

export const PersonAgreementsSection = ({ person }: PersonAgreementsSectionProps) => {
  // Prefer API that includes agreement.responses; fallback to person.agreements
  const { agreements: fetchedAgreements, isPending } = usePersonAgreements(person.id);
  console.log(fetchedAgreements)
  const agreements = (fetchedAgreements ?? person?.agreements ?? []).map((a: any) => {
    // Defensively scope responses to the current person to avoid showing other signers' links
    const allResponses = Array.isArray(a.responses) ? a.responses : [];
    const scopedResponses = allResponses.filter((r: any) => {
      const rid = r?.person_id || r?.person?.id;
      return !rid || rid === person.id; // if missing person_id, keep it; else ensure it matches
    });
    const responses = scopedResponses;
    const response_count = a.response_count ?? responses.length ?? 0;
    const agreed_count = a.agreed_count ?? (responses?.filter((r: any) => ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())).length ?? 0);
    const sent_count = a.sent_count ?? (Array.isArray(responses) ? responses.length : 0);
    return { ...a, responses, response_count, agreed_count, sent_count };
  });

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
        {isPending ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Text className="text-ui-fg-muted">Loading agreements…</Text>
          </div>
        ) : agreements.length === 0 ? (
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
