import { Button, Heading, IconButton, Input, Text, toast, Label, Switch } from "@medusajs/ui";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { useNavigate } from "react-router-dom";
import { Select } from "@medusajs/ui"
import { Plus, Minus } from "@medusajs/icons";
import { useEffect, useState } from "react";
import { Form } from "../common/form";
import { Collapsible } from "../ui/collapsible";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { AdminWebsite } from "../../hooks/api/websites";
import { useCreatePages } from "../../hooks/api/pages";
import { useNewsletterAiWrite } from "../../hooks/api/marketing";

const pageSchema = z.object({
  pages: z.array(z.object({
    title: z.string().min(1, "Title is required"),
    slug: z.string().min(1, "Slug is required"),
    content: z.string().min(1, "Content is required"),
    page_type: z.enum([
      "Home",
      "About",
      "Contact",
      "Blog",
      "Product",
      "Service",
      "Portfolio",
      "Landing",
      "Custom",
      "Newsletter"
    ]),
    status: z.enum(["Draft", "Published", "Archived"]).default("Draft"),
    meta_title: z.string().optional(),
    meta_description: z.string().optional(),
    meta_keywords: z.string().optional(),
    published_at: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    genMetaDataLLM: z.boolean().optional().default(false),
  }))
});

const statusOptions = [
  {
    value: "Draft",
    label: "Draft",
  },
  {
    value: "Published",
    label: "Published",
  },
  {
    value: "Archived",
    label: "Archived",
  },
]

const pageTypeOptions = [
  { value: "Home", label: "Home" },
  { value: "About", label: "About" },
  { value: "Contact", label: "Contact" },
  { value: "Product", label: "Product" },
  { value: "Service", label: "Service" },
  { value: "Portfolio", label: "Portfolio" },
  { value: "Landing", label: "Landing" },
  { value: "Custom", label: "Custom" },
  { value: "Newsletter", label: "Newsletter" },
]

type PageFormValues = z.infer<typeof pageSchema>;

interface CreatePageComponentProps {
  websiteId: string;
  website?: AdminWebsite;
}

export function CreatePageComponent({ websiteId, website }: CreatePageComponentProps) {
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  const { handleSuccess } = useRouteModal();
  const createPages = useCreatePages(websiteId);

  const form = useForm<PageFormValues>({
    resolver: zodResolver(pageSchema) as any,
    defaultValues: {
      pages: [
        {
          title: "",
          slug: "",
          content: "",
          page_type: "Home",
          status: "Draft",
          meta_title: "",
          meta_description: "",
          meta_keywords: "",
          genMetaDataLLM: false,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pages",
  });

  // In-editor "Write with AI" for a Newsletter page: generate copy via the
  // ai_newsletter_drafter provider and drop it straight into the form fields.
  const { mutateAsync: writeNewsletter, isPending: isWriting } = useNewsletterAiWrite();
  const aiWriteNewsletter = async (index: number) => {
    try {
      const cur = [
        form.getValues(`pages.${index}.title`),
        form.getValues(`pages.${index}.content`),
      ].filter(Boolean).join("\n\n").trim();
      const res = await writeNewsletter(cur ? { context: cur } : undefined);
      form.setValue(`pages.${index}.title`, res.title || "");
      form.setValue(`pages.${index}.content`, res.content || "");
      toast.success(cur ? "Rewrote with AI — edit as needed." : "Drafted with AI — edit as needed.");
    } catch {
      toast.error("AI draft failed — configure an AI provider (role ai_newsletter_drafter) or OPENROUTER_API_KEY.");
    }
  };

  const addNewPage = () => {
    append({
      title: "",
      slug: "",
      content: "",
      page_type: "Home",
      status: "Draft",
      meta_title: "",
      meta_description: "",
      meta_keywords: "",
      genMetaDataLLM: false,
    });
    setExpandedSections(prev => ({
      ...prev,
      [fields.length]: true
    }));
  };

  const removePage = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };

  const toggleSection = (index: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  useEffect(() => {
    // Expand first section by default
    setExpandedSections({ 0: true });
  }, []);

  const handleSubmit = form.handleSubmit(async (values: PageFormValues) => {
    try {
      // If there's only one page, send it as a single object
      // Otherwise, send it as an array in pages
      const payload = values.pages.length === 1 
        ? values.pages[0] 
        : { pages: values.pages };

      createPages.mutate(
        payload,
        {
          onSuccess: () => {
            if (values.pages.length === 1) {
              toast.success(" Page created successfully");
              handleSuccess(`/websites/${websiteId}`);
              return;
            } else {
              toast.success(" Pages created successfully");
              handleSuccess(`/websites/${websiteId}`);
            }
            
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create pages");
          },
        }
      );
    } catch (error) {
      toast.error("Failed to create pages");
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
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
       
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Pages</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create new pages for {website?.name}
              </Text>
            </div>

            <div className="flex flex-col gap-y-4">
              {fields.map((field, index) => (
                <Collapsible
                  key={field.id}
                  open={expandedSections[index]}
                  onOpenChange={() => toggleSection(index)}
                >
                  <div className="border rounded-lg">
                    <div className="flex items-center justify-between p-4 border-b">
                      <Text size="base" weight="plus">
                        Page {index + 1}
                      </Text>
                      <div className="flex items-center gap-x-2">
                        <IconButton
                          size="small"
                          variant="primary"
                          onClick={() => toggleSection(index)}
                        >
                          {expandedSections[index] ? "-" : "+"}
                        </IconButton>
                        {fields.length > 1 && (
                          <IconButton
                            size="small"
                            variant="transparent"
                            onClick={() => removePage(index)}
                          >
                            <Minus />
                          </IconButton>
                        )}
                      </div>
                    </div>
                    
                    <div className={expandedSections[index] ? "p-4" : "hidden"}>
                      <div className="grid gap-4">
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.title`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Title</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.slug`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Slug</Form.Label>
                              <Form.Control>
                                <Input 
                                  autoComplete="off" 
                                  {...field} 
                                  onChange={(e) => {
                                    // Convert spaces to hyphens and remove special characters
                                    const value = e.target.value
                                      .toLowerCase()
                                      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except hyphens
                                      .replace(/\s+/g, '-')          // Convert spaces to hyphens
                                      .replace(/-+/g, '-')          // Replace multiple hyphens with single hyphen
                                    field.onChange(value)
                                  }}
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.content`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Content</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.page_type`}
                          render={({ field: { value, onChange, ...rest } }) => (
                            <Form.Item>
                              <Form.Label>Page Type</Form.Label>
                              <Form.Control>
                                <Select 
                                  value={value} 
                                  onValueChange={onChange}
                                  {...rest}
                                >
                                  <Select.Trigger>
                                    <Select.Value placeholder="Select a page type" />
                                  </Select.Trigger>
                                  <Select.Content>
                                    {pageTypeOptions.map((item) => (
                                      <Select.Item key={item.value} value={item.value}>
                                        {item.label}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select>
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        {form.watch(`pages.${index}.page_type`) === "Newsletter" && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            isLoading={isWriting}
                            onClick={() => aiWriteNewsletter(index)}
                          >
                            Write with AI
                          </Button>
                        )}

                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.status`}
                          render={({ field: { value, onChange, ...rest } }) => (
                            <Form.Item>
                              <Form.Label>Status</Form.Label>
                              <Form.Control>
                                <Select 
                                  value={value} 
                                  onValueChange={onChange}
                                  {...rest}
                                >
                                <Select.Trigger>
                            <Select.Value placeholder="Select a status" />
                           </Select.Trigger>
                                <Select.Content>
                                {statusOptions.map((item) => (
                              <Select.Item key={item.value} value={item.value}>
                                {item.label}
                              </Select.Item>
                            ))}
                                </Select.Content>
                                  
                                </Select>
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        {/* AI Metadata Switch */}
                        <div className="flex items-center gap-2 mb-2">
                          <Label htmlFor={`pages.${index}.genMetaDataLLM`}>Generate Meta with AI</Label>
                          <Switch
                            id={`pages.${index}.genMetaDataLLM`}
                            checked={form.watch(`pages.${index}.genMetaDataLLM`)}
                            onCheckedChange={(val: boolean) => form.setValue(`pages.${index}.genMetaDataLLM`, val)}
                          />
                        </div>

                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.meta_title`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Meta Title</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} disabled={form.watch(`pages.${index}.genMetaDataLLM`)} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.meta_description`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Meta Description</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} disabled={form.watch(`pages.${index}.genMetaDataLLM`)} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={form.control}
                          name={`pages.${index}.meta_keywords`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Meta Keywords</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} disabled={form.watch(`pages.${index}.genMetaDataLLM`)} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                </Collapsible>
              ))}
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="secondary"
              onClick={addNewPage}
            >
              <Plus className="text-ui-fg-base" />
              Add Another Page
            </Button>
            <div className="flex items-center gap-x-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/websites/${websiteId}`)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Create Pages
              </Button>
            </div>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
