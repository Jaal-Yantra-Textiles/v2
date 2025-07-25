import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, ProgressTabs, ProgressStatus, toast } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateAgreement } from "../../hooks/api/agreement";
import { useState } from "react";
import { AgreementBasicStep } from "./agreement/basic-step";
import { AgreementContentStep } from "./agreement";

// Define the tabs
enum Tab {
  BASIC = "basic",
  CONTENT = "content",
}

const agreementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  status: z.string().min(1, "Status is required"),
  subject: z.string().min(1, "Subject is required"),
  template_key: z.string().optional(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
  from_email: z.string().email("Invalid email format").optional().or(z.literal("")),
  content: z.string().min(1, "Content is required"),
});

type AgreementFormData = z.infer<typeof agreementSchema>;

export const CreateAgreementSteps = () => {
  const [tab, setTab] = useState<Tab>(Tab.BASIC);
  const [tabState, setTabState] = useState<Record<Tab, ProgressStatus>>({
    [Tab.BASIC]: "in-progress",
    [Tab.CONTENT]: "not-started",
  });

  const form = useForm<AgreementFormData>({
    defaultValues: {
      title: "",
      status: "draft",
      subject: "",
      template_key: "",
      valid_from: "",
      valid_until: "",
      from_email: "",
      content: "",
    },
    resolver: zodResolver(agreementSchema),
  });

  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreateAgreement();

  const handleNextTab = async (currentTab: Tab, nextTab: Tab, fieldsToValidate?: (keyof AgreementFormData)[]) => {
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
    // Transform data to match API expectations
    const transformedData = {
      ...data,
      // Convert empty strings to undefined for optional fields
      template_key: data.template_key || undefined,
      valid_from: data.valid_from || undefined,
      valid_until: data.valid_until || undefined,
      from_email: data.from_email || undefined,
      // Set default counts
      sent_count: 0,
      response_count: 0,
      agreed_count: 0,
    };

    try {
      const result = await mutateAsync(transformedData);
      toast.success("Agreement created successfully!");
      handleSuccess(`/settings/agreements/${result.agreement.id}`);
    } catch (error) {
      console.error("Create agreement error:", error);
      toast.error("Failed to create agreement");
    }
  });



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
                  className="w-full max-w-[200px]"
                >
                  General
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  value={Tab.CONTENT}
                  status={tabState[Tab.CONTENT]}
                  className="w-full max-w-[200px]"
                >
                  Content
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            <div className="flex size-full flex-col overflow-hidden">
              <ProgressTabs.Content
                value={Tab.BASIC}
                className="size-full overflow-y-auto data-[state=inactive]:hidden"
              >
                <AgreementBasicStep control={form.control} />
              </ProgressTabs.Content>

              <ProgressTabs.Content
                value={Tab.CONTENT}
                className="size-full overflow-y-auto data-[state=inactive]:hidden"
              >
                <AgreementContentStep control={form.control} />
              </ProgressTabs.Content>
            </div>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-x-2">
                {tab === Tab.CONTENT && (
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.BASIC)}
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-x-2">
                {tab === Tab.BASIC && (
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={() => handleNextTab(Tab.BASIC, Tab.CONTENT, ["title", "status", "subject"])}
                  >
                    Continue
                  </Button>
                )}
                {tab === Tab.CONTENT && (
                  <Button
                    variant="primary"
                    type="submit"
                    size="small"
                    isLoading={isPending}
                    disabled={isPending}
                  >
                    Create Agreement
                  </Button>
                )}
              </div>
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
