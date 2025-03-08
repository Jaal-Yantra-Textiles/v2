import { Badge, Button, Heading, Input, Text, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Select } from "@medusajs/ui";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateWebsite } from "../../hooks/api/websites";

const websiteSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["Active", "Inactive", "Maintenance", "Development"]).default("Development"),
  primary_language: z.string().min(1, "Primary language is required").default("en"),
  supported_languages: z.record(z.string(), z.string()).default({ en: "English" }),
  analytics_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const statusOptions = [
  { value: "Development", label: "Development" },
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
  { value: "Maintenance", label: "Maintenance" },
];

const languageOptions = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "hi", label: "Hindi" },
];

type WebsiteFormValues = z.infer<typeof websiteSchema>;

export function CreateWebsiteComponent() {
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  const createWebsite = useCreateWebsite();

  const form = useForm<WebsiteFormValues>({
    resolver: zodResolver(websiteSchema),
    defaultValues: {
      domain: "",
      name: "",
      description: "",
      status: "Development",
      primary_language: "en",
      supported_languages: {},
      analytics_id: "",
    },
  });

  const handleSubmit = form.handleSubmit(async (values: WebsiteFormValues) => {
    try {
      createWebsite.mutate(
        values,
        {
          onSuccess: (response) => {
            toast.success("Website created successfully");
            handleSuccess(`/websites/${response.website.id}`);
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create website");
          },
        }
      );
    } catch (error) {
      toast.error("Failed to create website");
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <RouteFocusModal.Description></RouteFocusModal.Description>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Title></RouteFocusModal.Title>
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 px-4 md:py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8 mx-auto">
            <div>
              <Heading>Create Website</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create a new website with basic information.
              </Text>
            </div>

            <div className="flex flex-col gap-y-4 w-full">
            <Form.Field
              control={form.control}
              name="domain"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Domain</Form.Label>
                  <Form.Control>
                    <Input placeholder="example.com" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input placeholder="My Website" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="description"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Description</Form.Label>
                  <Form.Control>
                    <Input placeholder="A brief description of your website" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="status"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Status</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      size="small"
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select a status" />
                      </Select.Trigger>
                      <Select.Content>
                        {statusOptions.map((option) => (
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

            <Form.Field
              control={form.control}
              name="primary_language"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Primary Language</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      size="small"
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select a language" />
                      </Select.Trigger>
                      <Select.Content>
                        {languageOptions.map((option) => (
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

            <Form.Field
              control={form.control}
              name="supported_languages"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Supported Languages</Form.Label>
                  <Form.Control>
                    <div className="flex flex-col gap-y-2">
                      <Select
                        value=""
                        onValueChange={(value: string) => {
                          const langOption = languageOptions.find(opt => opt.value === value);
                          const newValues = { ...field.value };
                          if (!newValues[value]) {
                            newValues[value] = langOption?.label || value;
                            field.onChange(newValues);
                          }
                        }}
                        size="small"
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select languages" />
                        </Select.Trigger>
                        <Select.Content>
                          {languageOptions.map((option) => (
                            <Select.Item key={option.value} value={option.value}>
                              {option.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                      {field.value && Object.keys(field.value).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(field.value).map(([key, label]) => (
                              <Badge key={key} color="green" className="flex items-center gap-x-1">
                                <span>{label}</span>
                                <button
                                  type="button"
                                  className="text-ui-fg-subtle hover:text-ui-fg-base ml-1"
                                  onClick={() => {
                                    const newValues = { ...field.value };
                                    delete newValues[key];
                                    field.onChange(newValues);
                                  }}
                                >
                                  ×
                                </button>
                              </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="analytics_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Analytics ID</Form.Label>
                  <Form.Control>
                    <Input placeholder="UA-XXXXXXXXX-X" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer className="flex gap-x-2 justify-end px-4 md:px-6">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/websites")}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={form.formState.isSubmitting}>
            Create
          </Button>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
