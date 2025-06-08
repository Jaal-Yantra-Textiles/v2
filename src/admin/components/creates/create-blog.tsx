import { Badge, Button, Heading, Input, toast, ProgressTabs, ProgressStatus, Textarea, Tooltip } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Select } from "@medusajs/ui";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreatePagesWithBlocks } from "../../hooks/api/pages";
import type { Block } from "../../hooks/api/pages";
import { InformationCircleSolid } from "@medusajs/icons"


import { useUsers } from "../../hooks/api/users";


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
  blocks: z.array(blockSchema).optional(),
});

enum Tab {
  GENERAL = "general"
}

type TabState = Record<Tab, ProgressStatus>

interface CreateBlogComponentProps {
  websiteId: string;
}

export function CreateBlogComponent({ websiteId }: CreateBlogComponentProps) {
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  const createPagesWithBlocks = useCreatePagesWithBlocks(websiteId);
  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress"
  });
  const firstImageUrl = "";

  const { users } = useUsers()

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
      // Add default blocks array with proper structure
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
  
  // Form validation is now working with proper default values

  useEffect(() => {
    const currentState = { ...tabState };
    if (tab === Tab.GENERAL) {
      currentState[Tab.GENERAL] = "in-progress";
    }
    setTabState(currentState);
  }, [tab]);

  const handleSubmit = form.handleSubmit(async (data: any) => {
    try {
      // Create a properly typed object with all required fields
      const values = {
        title: data.title,
        slug: data.slug,
        content: data.content,
        page_type: "Blog" as const,
        status: data.status || "Draft",
        meta_title: data.meta_title || '',
        meta_description: data.meta_description || '',
        meta_keywords: data.meta_keywords || '',
      };
      
      // Create the page first
      const pageData = {
        ...values,
      };
      
      // Create a default authors array
      const authors: string[] = [];

      // Then create the block
      const blockData = {
        blocks: [
          {
            name: "Main Blog",
            type: "MainContent" as const,
            content: {
              text: '', // Use the content field directly
              layout: "full" as const,
              authors: authors,
              image: {
                type: "image" as const,
                content: firstImageUrl,
              },
              type: "blog" as const,
            },
            settings: {
              alignment: "left" as const,
            },
            order: 0,
          } satisfies Block,
        ],
      };

      const formData = {
        ...pageData,
        ...blockData,
      };

      createPagesWithBlocks.mutate(
        formData,
        {
          onSuccess: () => {
            toast.success("Blog page with blocks created successfully");
            handleSuccess(`/websites/${websiteId}`);
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create blog page with blocks");
          },
        }
      );
    } catch (error) {
      toast.error("Failed to create blog page with blocks");
    }
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
                <ProgressTabs.Trigger
                  value={Tab.GENERAL}
                  status={tabState[Tab.GENERAL]}
                >
                  Blog Information
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              value={Tab.GENERAL}
              className="size-full overflow-y-auto"
            >
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
                            // If value doesn't start with /, apply blog path formatting
                            if (!value.startsWith('/')) {
                              value = value
                                .toLowerCase()
                                .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except hyphens
                                .replace(/\s+/g, '-')          // Convert spaces to hyphens
                                .replace(/-+/g, '-');         // Replace multiple hyphens with single hyphen
                            }
                            field.onChange(value);
                          }}
                        />
                      </Form.Control>
                      <Form.Hint className="text-ui-fg-subtle">
                        {form.watch('slug')?.startsWith('/') ? 
                          `Slug: ${form.watch('slug')}` : 
                          `Slug with: /blog/${form.watch('slug')}`
                        }
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
                  render={({field}) => (
                    <Form.Item>
                      <Form.Label>Summary</Form.Label>
                      <Form.Control>
                        <Textarea placeholder="Blog summary"  {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Form.Item className="hidden"> {/* Hidden since we're using Draft by default */}
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
                              const user = users?.find(u => u.id === selectedId);
                              if (user) {
                                const authorName = `${user.first_name} ${user.last_name || ''}`;
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
                              {users?.map((option) => (
                                <Select.Item key={option.id} value={option.id}>
                                  {option.first_name + " " + (option.last_name || '')}
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
          <div className="flex items-center justify-end gap-x-2">
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => navigate(`/websites/${websiteId}`)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              size="small"
              isLoading={createPagesWithBlocks.isPending}
              disabled={!form.formState.isValid}
            >
              Create Blog
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
