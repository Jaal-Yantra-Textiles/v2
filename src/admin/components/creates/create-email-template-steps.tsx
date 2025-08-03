import { Button, toast, ProgressTabs, ProgressStatus} from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useCreateEmailTemplates } from "../../hooks/api/email-templates";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { BasicStep, RecipientsStep, ContentStep, PreviewStep } from "./email-template";


// Email template schema with validation
const emailTemplateSchema = z.object({
  // Basic Info
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  template_key: z.string().min(1, "Template key is required"),
  template_type: z.string().min(1, "Template type is required"),
  from: z.string().email("Valid email is required"),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  html_content: z.string().min(1, "HTML content is required"),
  variables: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })).optional().default([]),
  is_active: z.boolean().default(true),
});

enum Tab {
  BASIC = "basic",
  RECIPIENTS = "recipients", 
  CONTENT = "content",
  PREVIEW = "preview",
}

type TabState = Record<Tab, ProgressStatus>;
type EmailTemplateSchema = z.infer<typeof emailTemplateSchema>;
type EmailTemplateField = keyof EmailTemplateSchema;

const templateTypes = [
  { label: "Welcome Email", value: "welcome" },
  { label: "Password Reset", value: "password_reset" },
  { label: "Order Confirmation", value: "order_confirmation" },
  { label: "Newsletter", value: "newsletter" },
  { label: "General", value: "general" },
  { label: "Document", value: "document" },
];

const commonVariables = [
  { name: "user_name", description: "User's full name" },
  { name: "user_email", description: "User's email address" },
  { name: "company_name", description: "Company name" },
  { name: "order_number", description: "Order number" },
  { name: "reset_link", description: "Password reset link" },
];

export const CreateEmailTemplateSteps = () => {
  const [tab, setTab] = useState<Tab>(Tab.BASIC);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.BASIC]: "not-started",
    [Tab.RECIPIENTS]: "not-started",
    [Tab.CONTENT]: "not-started",
    [Tab.PREVIEW]: "not-started",
  });

  const { handleSuccess } = useRouteModal();
  const { mutate, isPending } = useCreateEmailTemplates();

  const form = useForm({
    resolver: zodResolver(emailTemplateSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: "",
      template_key: "",
      template_type: "general",
      to: "",
      cc: "",
      bcc: "",
      from: "",
      subject: "",
      html_content: "",
      variables: [],
      is_active: true,
    },
  });

  useEffect(() => {
    setTabState((prev) => ({
      ...prev,
      [Tab.BASIC]: "in-progress",
    }));
  }, []);

  const handleNextTab = async (currentTab: Tab, nextTab: Tab, fieldsToValidate?: EmailTemplateField[]) => {
    let validationResult = true;
    if (fieldsToValidate) {
      validationResult = await form.trigger(fieldsToValidate);
    }

    if (validationResult) {
      setTabState((prev) => ({
        ...prev,
        [currentTab]: "completed",
        [nextTab]: "in-progress",
      }));
      setTab(nextTab);
    }
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    console.log('Form data before transformation:', data);
    // Transform variables array to object for API compatibility
    const transformedData = {
      ...data,
      variables: data.variables?.reduce((acc: Record<string, string>, variable: { key: string; value: string }) => {
        // Include variables even with empty values, but require a key
        if (variable.key) {
          acc[variable.key] = variable.value || "";
        }
        return acc;
      }, {}) || {}
    };
    
    mutate(transformedData, {
      onSuccess: ({ emailTemplate }) => {
        toast.success("Email template created successfully!");
        handleSuccess(`/settings/email-templates/${emailTemplate.id}`);
      },
      onError: () => {
        toast.error("Failed to create email template");
      },
    });
  });

  const insertVariableIntoContent = (varName: string) => {
    const currentContent = form.getValues("html_content");
    const variableTag = `{{${varName}}}`;
    form.setValue("html_content", currentContent + variableTag);
  };

  const handleTabChange = (tab: Tab) => {
    setTab(tab);
  };

  return (
      <RouteFocusModal.Form form={form}>
        <KeyboundForm
          onSubmit={handleSubmit}
          className="flex h-full flex-col overflow-hidden"
        >
          <ProgressTabs
            value={tab}
            onValueChange={async (value) => {
              const valid = await form.trigger();
              if (!valid) {
                return;
              }
              setTab(value as Tab);
            }}
            className="flex h-full flex-col overflow-hidden"
          >
            <RouteFocusModal.Header>
              <div className="-my-2 w-full border-l">
                <ProgressTabs.List className="flex w-full items-center justify-start">
                  <ProgressTabs.Trigger
                    value={Tab.BASIC}
                    status={tabState[Tab.BASIC]}
                    onClick={() => handleTabChange(Tab.BASIC)}
                  >
                    Basic Info
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    value={Tab.RECIPIENTS}
                    status={tabState[Tab.RECIPIENTS]}
                    onClick={() => handleTabChange(Tab.RECIPIENTS)}
                    disabled={tabState[Tab.BASIC] !== 'completed' && tabState[Tab.RECIPIENTS] === 'not-started'}
                  >
                    Recipients
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    value={Tab.CONTENT}
                    status={tabState[Tab.CONTENT]}
                    onClick={() => handleTabChange(Tab.CONTENT)}
                    disabled={(tabState[Tab.BASIC] !== 'completed' || tabState[Tab.RECIPIENTS] !== 'completed') && tabState[Tab.CONTENT] === 'not-started'}
                  >
                    Content
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    value={Tab.PREVIEW}
                    status={tabState[Tab.PREVIEW]}
                    onClick={() => handleTabChange(Tab.PREVIEW)}
                    disabled={(tabState[Tab.BASIC] !== 'completed' || tabState[Tab.RECIPIENTS] !== 'completed' || tabState[Tab.CONTENT] !== 'completed') && tabState[Tab.PREVIEW] === 'not-started'}
                  >
                    Preview
                  </ProgressTabs.Trigger>
                </ProgressTabs.List>
              </div>
            </RouteFocusModal.Header>
            <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-full w-full flex-col">
                {/* Basic Info Tab */}
                <ProgressTabs.Content value={Tab.BASIC} className="flex-1 h-full overflow-y-auto">
                  <BasicStep control={form.control} templateTypes={templateTypes} />
                </ProgressTabs.Content>

                {/* Recipients Tab */}
                <ProgressTabs.Content value={Tab.RECIPIENTS} className="flex-1 h-full overflow-y-auto">
                  <RecipientsStep control={form.control} />
                </ProgressTabs.Content>

                {/* Content Tab */}
                <ProgressTabs.Content value={Tab.CONTENT} className="flex-1 h-full overflow-y-auto">
                  <ContentStep 
                    control={form.control} 
                    variables={commonVariables}
                    onInsertVariable={insertVariableIntoContent}
                  />
                </ProgressTabs.Content>

                {/* Preview Tab */}
                <ProgressTabs.Content value={Tab.PREVIEW} className="flex-1 h-full overflow-y-auto">
                  <PreviewStep watch={form.watch} />
                </ProgressTabs.Content>
              </div>
            </RouteFocusModal.Body>
                <RouteFocusModal.Footer>
                  <div className="flex items-center justify-end gap-x-2">
                    <div className="flex items-center gap-x-2">
                      {tab === Tab.BASIC && (
                        <>
                          <Button
                            variant="primary"
                            size="small"
                            type="button"
                            onClick={() => handleNextTab(Tab.BASIC, Tab.RECIPIENTS, ["name", "description"])}
                          >
                            Continue
                          </Button>
                        </>
                      )}
                      {tab === Tab.RECIPIENTS && (
                        <>
                          <Button
                            variant="secondary"
                            size="small"
                            type="button"
                            onClick={() => setTab(Tab.BASIC)}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            size="small"
                            type="button"
                            onClick={() => handleNextTab(Tab.RECIPIENTS, Tab.CONTENT, ["from"])}
                          >
                            Continue
                          </Button>
                        </>
                      )}
                      {tab === Tab.CONTENT && (
                        <>
                          <Button
                            variant="secondary"
                            size="small"
                            type="button"
                            onClick={() => setTab(Tab.RECIPIENTS)}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            size="small"
                            type="button"
                            onClick={() => handleNextTab(Tab.CONTENT, Tab.PREVIEW, ["subject", "html_content"])}
                          >
                            Continue
                          </Button>
                        </>
                      )}
                      {tab === Tab.PREVIEW && (
                        <>
                          <Button
                            variant="secondary"
                            size="small"
                            type="button"
                            onClick={() => setTab(Tab.CONTENT)}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            type="submit"
                            size="small"
                            isLoading={isPending}
                            disabled={isPending || tab !== Tab.PREVIEW}
                          >
                            Create Email Template
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </RouteFocusModal.Footer>
              </ProgressTabs>
        </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
