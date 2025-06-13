import { Badge, Button, Heading, Input, toast, ProgressTabs, ProgressStatus, Textarea, Tooltip, Select, Checkbox } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useCreatePagesWithBlocks, type CreatePagesPayload, type AdminPageResponse, type AdminPagesResponse } from "../../hooks/api/pages"; // Ensure AdminPage is imported if used standalone, otherwise it's part of AdminPageResponse
import { useBlogCategories } from "../../hooks/api/blogs";
import { useUsers } from "../../hooks/api/users";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { InformationCircleSolid } from "@medusajs/icons";
import type { FetchError } from "@medusajs/js-sdk";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { AdminUser } from '@medusajs/framework/types'

const blockSchema = z.object({
  name: z.string(),
  type: z.literal("MainContent"),
  content: z.object({
    authors: z.array(z.string()).default([]),
    image: z.object({
      type: z.literal("image"),
      content: z.string(),
    }),
    type: z.literal("blog"),
    text: z.string(),
    layout: z.string(),
  }).default({
    authors: [],
    image: { type: "image", content: "" },
    type: "blog",
    text: "",
    layout: "full",
  }),
  settings: z.object({
    alignment: z.literal("left"),
  }).default({
    alignment: "left",
  }),
  order: z.number(),
});

const blogSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  content: z.string().min(1, "Content description is required"),
  page_type: z.literal("Blog"),
  status: z.enum(["Draft", "Published", "Archived"]),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_keywords: z.string().optional(),
  category: z.string().optional(), // Existing category selection
  new_category_name: z.string().optional(), // For creating a new category
  is_featured: z.boolean().optional(),
  authors: z.array(z.string()).optional(), // For the TagsInput authors field
  blocks: z.array(blockSchema).optional(),
});

enum Tab {
  GENERAL = "general",
  ORGANISE = "organise",
  SEO = "seo",
}

type TabState = Record<Tab, ProgressStatus>;

interface CreateBlogComponentProps {
  websiteId: string;
}

type BlogSchema = z.infer<typeof blogSchema>;

// Define the type for the fields to validate, matching keys in BlogSchema
type BlogField = keyof BlogSchema;

export function CreateBlogComponent({ websiteId }: CreateBlogComponentProps) {
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  const { mutate, isPending } = useCreatePagesWithBlocks(websiteId);
  const { categories: categoryList, isLoading: isLoadingCategories } = useBlogCategories(websiteId);
  const { users } = useUsers();
  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "not-started",
    [Tab.ORGANISE]: "not-started",
    [Tab.SEO]: "not-started",
  });

  const form = useForm({
    resolver: zodResolver(blogSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
      slug: "",
      content: "",
      page_type: "Blog",
      status: "Draft",
      meta_title: "",
      meta_description: "",
      meta_keywords: "",
      blocks: [
        {
          name: "MainContent",
          type: "MainContent",
          content: {
            authors: [],
            image: { type: "image", content: "" },
            type: "blog",
            text: "",
            layout: "full",
          },
          settings: {
            alignment: "left",
          },
          order: 0,
        },
      ],
    },
  });

  useEffect(() => {
    // Set initial tab state
    setTabState((prev) => ({
      ...prev,
      [Tab.GENERAL]: "in-progress",
    }));
  }, []);

  const handleTabChange = (newTab: Tab) => {
    // Allow navigation to already completed tabs or the current in-progress tab
    if (tabState[newTab] === "completed" || tabState[newTab] === "in-progress") {
      setTab(newTab);
    }
  };

  const handleNextTab = async (currentTab: Tab, nextTab: Tab, fieldsToValidate?: BlogField[]) => {
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
    } else {
      // Highlight the current tab if validation fails and it's not already in-progress
      // This helps if the user clicked a tab trigger directly and validation failed
      setTabState((prev) => ({
        ...prev,
        [currentTab]: "in-progress",
      }));
    }
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    const pageData: CreatePagesPayload = {
      title: data.title,
      slug: data.slug,
      content: data.content,
      page_type: "Blog" as const,
      status: data.status || "Draft",
      meta_title: data.meta_title || "",
      meta_description: data.meta_description || "",
      meta_keywords: data.meta_keywords || "",
      public_metadata: {
        // Prioritize new_category_name if provided, otherwise use selected category
        category: data.new_category_name ? data.new_category_name.trim() : (data.category || undefined),
        ...(data.authors && { authors: data.authors.join(", ") }),
        is_featured: data.is_featured || false,
      },
      blocks: [
        {
          name: "Main Content",
          type: "MainContent",
          content: {
            image: { type: "image", content: "" },
            type: "blog",
            text: "",
            layout: "full",
          },
          settings: {
            alignment: "left",
          },
          order: 0,
        },
      ],
    };

    mutate(pageData, {
      onSuccess: (responseData: AdminPageResponse | AdminPagesResponse) => {
        toast.success("Blog page with blocks created successfully");
        // The actual created page ID should be in responseData.page.id
        let pageIdToRedirect: string | undefined = undefined;

        // Check if responseData is of type AdminPageResponse (has a 'page' property)
        if ('page' in responseData && responseData.page?.id) {
          pageIdToRedirect = responseData.page.id;
        // Check if responseData is of type AdminPagesResponse (has a 'pages' property)
        } else if ('pages' in responseData && responseData.pages?.length > 0 && responseData.pages[0]?.id) {
          pageIdToRedirect = responseData.pages[0].id;
        }

        if (pageIdToRedirect) {
          handleSuccess(`/websites/${websiteId}/pages/${pageIdToRedirect}`);
        } else {
          console.warn("Created page ID not found in response. Response:", responseData);
          handleSuccess(`/websites/${websiteId}/pages/`); // Fallback to the list of pages
        }
      },
      onError: (error: FetchError) => {
        toast.error(error.message);
      },
    });
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
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
                <ProgressTabs.Trigger value={Tab.GENERAL} status={tabState.general} onClick={() => handleTabChange(Tab.GENERAL)}>General</ProgressTabs.Trigger>
                <ProgressTabs.Trigger value={Tab.ORGANISE} status={tabState.organise} onClick={() => handleTabChange(Tab.ORGANISE)} disabled={tabState.general !== 'completed' && tabState.organise === 'not-started'}>Organise</ProgressTabs.Trigger>
                <ProgressTabs.Trigger value={Tab.SEO} status={tabState.seo} onClick={() => handleTabChange(Tab.SEO)} disabled={(tabState.general !== 'completed' || tabState.organise !== 'completed') && tabState.seo === 'not-started'}>SEO</ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content value={Tab.GENERAL}>
              <div className="flex flex-col gap-y-4 p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <div className="flex items-center gap-x-2">
                    <Heading className="text-xl">Blog Information</Heading>
                  </div>
                </div>
                <Form.Field
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Title</Form.Label>
                      <Form.Control>
                        <Input placeholder="My Blog Post" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <Form.Item>
                      <div className="flex items-center gap-x-2">
                        <Form.Label>Slug</Form.Label>
                        <Tooltip content="Path will be prefixed with /blog/ unless you start with a forward slash (/) for a custom path.">
                          <InformationCircleSolid className="text-ui-fg-subtle" />
                        </Tooltip>
                      </div>
                      <Form.Control>
                        <Input
                          placeholder="my-blog-post"
                          {...field}
                          onChange={(e) => {
                            let value = e.target.value;
                            if (!value.startsWith("/")) {
                              value = value
                                .toLowerCase()
                                .replace(/[^a-z0-9\s-]/g, "")
                                .replace(/\s+/g, "-")
                                .replace(/-+/g, "-");
                            }
                            field.onChange(value);
                          }}
                        />
                      </Form.Control>
                      <Form.Hint className="text-ui-fg-subtle">
                        {form.watch("slug")?.startsWith("/")
                          ? `Slug: ${form.watch("slug")}`
                          : `Slug with: /blog/${form.watch("slug")}`}
                      </Form.Hint>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="page_type"
                  render={() => (
                    <Form.Item>
                      <Form.Label>Page Type</Form.Label>
                      <Form.Control>
                        <Input value="Blog" disabled />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Summary</Form.Label>
                      <Form.Control>
                        <Textarea placeholder="Blog summary" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Form.Item className="hidden">
                      <Form.Label>Status</Form.Label>
                      <Form.Control>
                        <Input type="hidden" {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="blocks.0.content.authors"
                  render={({ field: { value = [], onChange, ...rest } }) => (
                    <Form.Item>
                      <Form.Label>Authors</Form.Label>
                      <div className="flex flex-col gap-y-2">
                        <Form.Control>
                          <Select
                            value=""
                            onValueChange={(selectedId) => {
                              const user = users?.find((u: AdminUser) => u.id === selectedId);
                              if (user) {
                                const authorName = `${user.first_name} ${user.last_name || ""}`;
                                if (!value.includes(authorName)) {
                                  onChange([...value, authorName]);
                                }
                              }
                            }}
                            {...rest}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select authors" />
                            </Select.Trigger>
                            <Select.Content>
                              {users?.map((option: AdminUser) => (
                                <Select.Item key={option.id} value={option.id}>
                                  {option.first_name + " " + (option.last_name || "")}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <div className="flex flex-wrap gap-2">
                          {value.map((author, index) => (
                            <Badge
                              key={index}
                              className="cursor-pointer"
                              onClick={() => {
                                const newAuthors = value.filter((_, i) => i !== index);
                                onChange(newAuthors);
                              }}
                            >
                              {author}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </ProgressTabs.Content>

            <ProgressTabs.Content value={Tab.ORGANISE}>
              <div className="flex flex-col gap-y-4 p-8">
                <Heading level="h2">Organise</Heading>
                <Form.Field
                  control={form.control}
                  name="category" // This will be for selecting an EXISTING category
                  render={({ field }) => {
                    const categoryOptions = categoryList?.map((catName: string) => ({ value: catName, label: catName })) || [];
                    return (
                      <Form.Item>
                        <Form.Label>Existing Category (Optional)</Form.Label>
                        <Form.Control>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select an existing category" />
                            </Select.Trigger>
                            <Select.Content>
                              {isLoadingCategories && <Select.Item value="loading" disabled>Loading...</Select.Item>}
                              {!isLoadingCategories && categoryOptions.length === 0 && (
                                <Select.Item value="no-options" disabled>
                                  No existing categories found.
                                </Select.Item>
                              )}
                              {categoryOptions.map((option: { value: string; label: string }) => (
                                <Select.Item key={option.value} value={option.value}>
                                  {option.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    );
                  }}
                />

                <Form.Field
                  control={form.control}
                  name="new_category_name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Or Create New Category</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Enter new category name" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="is_featured"
                  render={({ field }) => (
                    <Form.Item>
                      <div className="flex items-center gap-x-2">
                        <Form.Control>
                          <Checkbox
                            id="is_featured_checkbox"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </Form.Control>
                        <Form.Label htmlFor="is_featured_checkbox">Is Featured?</Form.Label>
                      </div>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </ProgressTabs.Content>

            <ProgressTabs.Content value={Tab.SEO}>
              <div className="flex flex-col gap-y-4 p-8">
                <Heading level="h2">SEO</Heading>
                <Form.Field
                  control={form.control}
                  name="meta_title"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meta Title</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="meta_description"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meta Description</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="meta_keywords"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Meta Keywords</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>
        </ProgressTabs>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => navigate(`/websites/${websiteId}`)}
            >
              Cancel
            </Button>
            <div className="flex items-center gap-x-2">
              {tab === Tab.GENERAL && (
                <Button
                  variant="primary"
                  size="small"
                  type="button"
                  onClick={() => handleNextTab(Tab.GENERAL, Tab.ORGANISE, ['title', 'slug'])} // Add other general fields if needed
                >
                  Continue
                </Button>
              )}
              {tab === Tab.ORGANISE && (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.GENERAL)}
                  >
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={() => handleNextTab(Tab.ORGANISE, Tab.SEO, ['category'])} // Optional: validate category
                  >
                    Continue
                  </Button>
                </>
              )}
              {tab === Tab.SEO && (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.ORGANISE)}
                  >
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    size="small"
                    isLoading={isPending}
                    disabled={!form.formState.isValid} // Or check if all tabs are completed
                  >
                    Create Blog
                  </Button>
                </>
              )}
            </div>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
