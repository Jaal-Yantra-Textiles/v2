import { Button, Heading, Input, Select, Switch, Text, Textarea } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useCreateEmailTemplates } from "../../hooks/api/email-templates";

const createEmailTemplateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  from: z.string(),
  templateKey: z.string(),
  subject: z.string(),
  htmlContent: z.string(),
  variables: z.string().optional(),
  isActive: z.boolean(),
  templateType: z.string(),
});

type CreateEmailTemplateFormData = z.infer<typeof createEmailTemplateSchema>;

export const CreateEmailTemplate = () => {
  const navigate = useNavigate();
  const { mutateAsync: createEmailTemplate, isPending } = useCreateEmailTemplates();

  const form = useForm<CreateEmailTemplateFormData>({
    resolver: zodResolver(createEmailTemplateSchema),
    defaultValues: {
      name: "",
      description: "",
      to: "",
      cc: "",
      bcc: "",
      from: "no-reply@jyt.com",
      templateKey: "",
      subject: "",
      htmlContent: "",
      variables: "",
      isActive: false,
      templateType: "general",
    },
  });

  const handleSubmit = async (data: CreateEmailTemplateFormData) => {
    try {
      const result = await createEmailTemplate(data);
      toast.success("EmailTemplate created successfully");
      navigate(`/settings/email-templates/${result.emailTemplate.id}`);
    } catch (error) {
      toast.error("Failed to create emailTemplate");
    }
  };

  return (
    <RouteFocusModal>
      <RouteFocusModal.Form form={form}>
        <KeyboundForm
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button size="small" variant="secondary">
                  Cancel
                </Button>
              </RouteFocusModal.Close>
              <Button
                size="small"
                type="submit"
                isLoading={isPending}
                className="shrink-0"
              >
                Create
              </Button>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
            <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
              <div>
                <Heading className="text-xl md:text-2xl">{"Create Email Template"}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {"Create a new email template"}
                </Text>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Field
              control={form.control}
              name="name"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter name" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="description"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Description</Form.Label>
                  <Form.Control>
                    <Textarea {...formField} placeholder="Enter description" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="to"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>To</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter to" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="cc"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Cc</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter cc" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="bcc"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Bcc</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter bcc" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="from"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>From</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter from" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="templateKey"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Template Key</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter template key" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="subject"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Subject</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter subject" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="htmlContent"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Html Content</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter html content" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="variables"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Variables</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter variables" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="isActive"
              render={({ field: formField }) => (
                <Form.Item>
                  <div className="flex items-center space-x-2">
                    <Form.Control>
                      <Switch
                        checked={formField.value}
                        onCheckedChange={formField.onChange}
                      />
                    </Form.Control>
                    <Form.Label>Is Active</Form.Label>
                  </div>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="templateType"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>Template Type</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="text" placeholder="Enter template type" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
              </div>
            </div>
          </RouteFocusModal.Body>
        </KeyboundForm>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  );
};
