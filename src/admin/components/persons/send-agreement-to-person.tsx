import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { Form } from "../common/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useSendAgreementToPerson } from "../../hooks/api/persons";
import { useEmailTemplates } from "../../hooks/api/email-templates";
import { useAgreements } from "../../hooks/api/agreement";
import { useState } from "react";

const sendAgreementSchema = z.object({
  agreement_id: z.string().min(1, "Agreement ID is required"),
  template_key: z.string().min(1, "Email template is required"),
});

type SendAgreementFormData = z.infer<typeof sendAgreementSchema>;

type SendAgreementToPersonProps = {
  personId: string;
  personName?: string;
};

export const SendAgreementToPersonForm = ({ 
  personId, 
  personName 
}: SendAgreementToPersonProps) => {
  const [templateSearch, setTemplateSearch] = useState("");
  const [agreementSearch, setAgreementSearch] = useState("");
  
  const form = useForm<SendAgreementFormData>({
    defaultValues: {
      agreement_id: "",
      template_key: "",
    },
    resolver: zodResolver(sendAgreementSchema),
  });

  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useSendAgreementToPerson(personId);
  
  // Fetch agreements for the select dropdown
  const { 
    agreements = [], 
    isLoading: isAgreementsLoading 
  } = useAgreements({
    q: agreementSearch || undefined,
    limit: 50,
  });
  
  // Fetch email templates for the select dropdown
  const { 
    emailTemplates = [], 
    isLoading: isTemplatesLoading 
  } = useEmailTemplates({
    q: templateSearch || undefined,
    limit: 50,
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync(data);
      toast.success(`Agreement sent successfully to ${personName || 'person'}!`);
      handleSuccess();
    } catch (error) {
      console.error("Send agreement error:", error);
      toast.error("Failed to send agreement. Please try again.");
    }
  });

  // Agreement options for the select dropdown
  const agreementOptions = agreements.map((agreement) => ({
    value: agreement.id,
    label: `${agreement.title} (${agreement.status})`,
  }));

  // Template options for the select dropdown - only include templates with templateKey
  const templateOptions = emailTemplates
    .filter((template) => template.template_key) // Only templates with templateKey
    .map((template) => ({
      value: template.template_key!, // Use only templateKey, not ID
      label: `${template.name} (${template.template_key})`,
    }));

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <div className="flex flex-col gap-y-8">
            <div className="flex flex-col gap-y-4">
              <div className="mb-4">
                <Heading level="h2">Send Agreement</Heading>
                <Text className="text-ui-fg-subtle">
                  Send an agreement email to {personName || 'this person'} using a selected email template.
                </Text>
              </div>

              <Form.Field
                control={form.control}
                name="agreement_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Agreement</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        onOpenChange={(open) => {
                          if (open && agreementSearch) {
                            setAgreementSearch("");
                          }
                        }}
                      >
                        <Select.Trigger>
                          <Select.Value 
                            placeholder={isAgreementsLoading ? "Loading agreements..." : "Select an agreement"}
                          />
                        </Select.Trigger>
                        <Select.Content>
                          {agreementOptions.length > 0 ? (
                            agreementOptions.map((option) => (
                              <Select.Item key={option.value} value={option.value}>
                                {option.label}
                              </Select.Item>
                            ))
                          ) : (
                            <div className="p-2 text-sm text-ui-fg-muted">
                              {isAgreementsLoading ? "Loading..." : "No agreements found"}
                            </div>
                          )}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="template_key"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Email Template</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isTemplatesLoading}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder={
                            isTemplatesLoading 
                              ? "Loading templates..." 
                              : templateOptions.length === 0 
                                ? "No email templates found" 
                                : "Select an email template"
                          } />
                        </Select.Trigger>
                        <Select.Content>
                          {templateOptions.length > 0 && templateOptions.map((option) => (
                            <Select.Item key={option.value} value={option.value}>
                              {option.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {templateSearch && (
                <div className="mt-2">
                  <Input
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          </div>
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button
              type="submit"
              variant="primary"
              size="small"
              isLoading={isPending}
              disabled={isPending}
            >
              Send Agreement
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  );
};
