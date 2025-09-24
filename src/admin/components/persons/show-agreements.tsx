import { Badge, Button, Heading, ProgressAccordion, Text } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { usePersonAgreements } from "../../hooks/api/persons";
import { format } from "date-fns";

type ShowAgreementsProps = {
  personId: string;
  personName?: string;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "sent":
      return "blue";
    case "viewed":
      return "orange";
    case "agreed":
      return "green";
    case "declined":
      return "red";
    default:
      return "grey";
  }
};

const getAgreementStatusColor = (status: string) => {
  switch (status) {
    case "draft":
      return "grey";
    case "active":
      return "green";
    case "expired":
      return "orange";
    case "cancelled":
      return "red";
    default:
      return "grey";
  }
};

export const ShowAgreementsForm = ({ personId, personName }: ShowAgreementsProps) => {
  const { handleSuccess } = useRouteModal();

  // Use person-scoped agreements API to avoid leaking other signers' responses
  const { agreements: scopedAgreements, isPending: isLoading } = usePersonAgreements(personId);
  const agreements = scopedAgreements || [];

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="flex items-center justify-between">
          <div>
            <Heading level="h2">Agreements</Heading>
            <Text className="text-ui-fg-subtle">
              View agreements and responses for {personName || 'this person'}
            </Text>
          </div>
        </div>
      </RouteDrawer.Header>

      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Text>Loading agreements...</Text>
          </div>
        ) : agreements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Text className="text-ui-fg-muted">No agreements found</Text>
            <Text size="small" className="text-ui-fg-subtle mt-2">
              This person has no agreements yet.
            </Text>
          </div>
        ) : (
          <div className="w-full">
            <ProgressAccordion type="single">
              {agreements.map((agreement: any) => (
                <ProgressAccordion.Item key={agreement.id} value={agreement.id}>
                  <ProgressAccordion.Header>
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Text weight="plus" size="small">
                            {agreement.title}
                          </Text>
                          <Badge 
                            size="2xsmall" 
                            color={getAgreementStatusColor(agreement.status)}
                          >
                            {agreement.status}
                          </Badge>
                        </div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Created: {format(new Date(agreement.created_at), 'MMM dd, yyyy')}
                        </Text>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div className="flex flex-col">
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            Sent: {agreement.sent_count}
                          </Text>
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            Responses: {agreement.response_count}
                          </Text>
                        </div>
                      </div>
                    </div>
                  </ProgressAccordion.Header>
                  <ProgressAccordion.Content>
                    <div className="pb-6 space-y-4">
                      {/* Agreement Details */}
                      <div className="grid grid-cols-2 gap-4 p-4 bg-ui-bg-subtle rounded-lg">
                        <div>
                          <Text size="small" weight="plus" className="text-ui-fg-base">
                            Subject
                          </Text>
                          <Text size="small" className="text-ui-fg-subtle">
                            {agreement.subject || 'No subject'}
                          </Text>
                        </div>
                        <div>
                          <Text size="small" weight="plus" className="text-ui-fg-base">
                            Template Key
                          </Text>
                          <Text size="small" className="text-ui-fg-subtle">
                            {agreement.template_key || 'None'}
                          </Text>
                        </div>
                        <div>
                          <Text size="small" weight="plus" className="text-ui-fg-base">
                            Valid From
                          </Text>
                          <Text size="small" className="text-ui-fg-subtle">
                            {agreement.valid_from ? format(new Date(agreement.valid_from), 'MMM dd, yyyy') : 'Not set'}
                          </Text>
                        </div>
                        <div>
                          <Text size="small" weight="plus" className="text-ui-fg-base">
                            Valid Until
                          </Text>
                          <Text size="small" className="text-ui-fg-subtle">
                            {agreement.valid_until ? format(new Date(agreement.valid_until), 'MMM dd, yyyy') : 'Not set'}
                          </Text>
                        </div>
                      </div>

                      {/* Agreement Content */}
                      <div>
                        <Text size="small" weight="plus" className="text-ui-fg-base mb-2">
                          Content
                        </Text>
                        <div 
                          className="p-3 bg-ui-bg-subtle rounded-lg text-sm text-ui-fg-subtle max-h-32 overflow-y-auto"
                          dangerouslySetInnerHTML={{ __html: agreement.content }}
                        />
                      </div>

                      {/* Responses */}
                      <div>
                        <Text size="small" weight="plus" className="text-ui-fg-base mb-3">
                          Responses ({agreement.responses?.length || 0})
                        </Text>
                        
                        {agreement.responses && agreement.responses.length > 0 ? (
                          <div className="space-y-3">
                            {agreement.responses.map((response: any) => (
                              <div key={response.id} className="p-4 border border-ui-border-base rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <Badge 
                                      size="2xsmall" 
                                      color={getStatusColor(response.status)}
                                    >
                                      {response.status}
                                    </Badge>
                                    <Text size="small" className="text-ui-fg-subtle">
                                      {response.email_sent_to}
                                    </Text>
                                  </div>
                                  <Text size="xsmall" className="text-ui-fg-muted">
                                    {format(new Date(response.created_at), 'MMM dd, yyyy HH:mm')}
                                  </Text>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <Text size="xsmall" className="text-ui-fg-subtle">
                                      Sent At
                                    </Text>
                                    <Text size="xsmall">
                                      {response.sent_at ? format(new Date(response.sent_at), 'MMM dd, yyyy HH:mm') : 'Not sent'}
                                    </Text>
                                  </div>
                                  <div>
                                    <Text size="xsmall" className="text-ui-fg-subtle">
                                      Viewed At
                                    </Text>
                                    <Text size="xsmall">
                                      {response.viewed_at ? format(new Date(response.viewed_at), 'MMM dd, yyyy HH:mm') : 'Not viewed'}
                                    </Text>
                                  </div>
                                  <div>
                                    <Text size="xsmall" className="text-ui-fg-subtle">
                                      Responded At
                                    </Text>
                                    <Text size="xsmall">
                                      {response.responded_at ? format(new Date(response.responded_at), 'MMM dd, yyyy HH:mm') : 'No response'}
                                    </Text>
                                  </div>
                                  <div>
                                    <Text size="xsmall" className="text-ui-fg-subtle">
                                      Email Opened
                                    </Text>
                                    <Text size="xsmall">
                                      {response.email_opened ? 'Yes' : 'No'}
                                    </Text>
                                  </div>
                                </div>
                                
                                {response.response_notes && (
                                  <div className="mt-3 pt-3 border-t border-ui-border-base">
                                    <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                      Response Notes
                                    </Text>
                                    <Text size="small">
                                      {response.response_notes}
                                    </Text>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 bg-ui-bg-subtle rounded-lg text-center">
                            <Text size="small" className="text-ui-fg-muted">
                              No responses yet
                            </Text>
                          </div>
                        )}
                      </div>
                    </div>
                  </ProgressAccordion.Content>
                </ProgressAccordion.Item>
              ))}
            </ProgressAccordion>
          </div>
        )}
      </RouteDrawer.Body>

      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Button size="small" variant="secondary" onClick={() => handleSuccess()}>
            Close
          </Button>
        </div>
      </RouteDrawer.Footer>
    </RouteDrawer>
  );
};
