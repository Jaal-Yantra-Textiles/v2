import { Badge, Button, Heading, Input, toast, ProgressTabs, ProgressStatus, Textarea, Tooltip } from "@medusajs/ui";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { TextEditor } from "../common/richtext-editor";


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
  status: z.enum(["Draft", "Published", "Archived"]).default("Draft"),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_keywords: z.string().optional(),
  blocks: z.array(blockSchema).optional().default([{
    name: "Main Blog",
    type: "MainContent" as const,
    content: {
      authors: [] as string[],
      image: {
        type: "image" as const,
        content: "",
      },
      type: "blog" as const,
      text: "",
      layout: "full",
    },
    settings: {
      alignment: "left" as const,
    },
    order: 0,
  }]),
});

enum Tab {
  GENERAL = "general",
  CONTENT = "content"
}

type TabState = Record<Tab, ProgressStatus>

const statusOptions = [
  { value: "Draft", label: "Draft" },
  { value: "Published", label: "Published" },
  { value: "Archived", label: "Archived" },
];



type BlogFormValues = z.infer<typeof blogSchema>;

interface CreateBlogComponentProps {
  websiteId: string;
}

export function CreateBlogComponent({ websiteId }: CreateBlogComponentProps) {
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  const createPagesWithBlocks = useCreatePagesWithBlocks(websiteId);
  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress",
    [Tab.CONTENT]: "not-started",
  });
  const DEFAULT = '';
  const [editorContent, setEditorContent] = useState(DEFAULT);
  const [firstImageUrl, setFirstImageUrl] = useState("");
  const editorInstanceRef = useRef<any>(null);

 
  const { users } = useUsers()

  const form = useForm<BlogFormValues>({
    resolver: zodResolver(blogSchema),
    defaultValues: {
      title: "",
      slug: "",
      content: "",
      page_type: "Blog",
      status: "Draft",
      meta_title: "",
      meta_description: "",
      meta_keywords: "",
      blocks: [{
        name: "Main Blog",
        type: "MainContent" as const,
        content: {
          authors: [] as string[],
          image: {
            type: "image" as const,
            content: "",
          },
          type: "blog" as const,
          text: "",
          layout: "full",
        },
        settings: {
          alignment: "left" as const,
        },
        order: 0,
      }], // Will be populated by the editor effect
    },
  });

  // Function to extract the first image URL from editor content
  const extractFirstImageUrl = useCallback((editor: any) => {
    if (!editor || !editor.state) return "";
    
    try {
      // Find the first image node in the editor
      let imageUrl = "";
      
      // Access the document and traverse it safely
      const doc = editor.state.doc;
      if (doc && typeof doc.descendants === 'function') {
        doc.descendants((node: any) => {
          if (node.type && node.type.name === 'image' && !imageUrl && node.attrs && node.attrs.src) {
            imageUrl = node.attrs.src;
            return false; // Stop traversing once we find the first image
          }
          return true; // Continue traversing
        });
      }
      
      return imageUrl;
    } catch (error) {
      console.error('Error extracting image URL:', error);
      return "";
    }
  }, []);

  const onNext = async (currentTab: Tab) => {
    const valid = await form.trigger();
    if (!valid) {
      return;
    }

    if (currentTab === Tab.GENERAL) {
      setTab(Tab.CONTENT);
    }
  };

  const onBack = () => {
    if (tab === Tab.CONTENT) {
      setTab(Tab.GENERAL);
    }
  };

  useEffect(() => {
    const currentState = { ...tabState };
    if (tab === Tab.GENERAL) {
      currentState[Tab.GENERAL] = "in-progress";
      currentState[Tab.CONTENT] = "not-started";
    }
    if (tab === Tab.CONTENT) {
      currentState[Tab.GENERAL] = "completed";
      currentState[Tab.CONTENT] = "in-progress";
    }
    setTabState(currentState);
  }, [tab]);

  const handleSubmit = form.handleSubmit(async (values: BlogFormValues) => {
    try {
      // Create the page first
      const pageData = {
        ...values,
      };

      // extract authors
      const authors = pageData.blocks[0]?.content?.authors || [];

      // Then create the block
      const blockData = {
        blocks: [
          {
            name: "Main Blog",
            type: "MainContent" as const,
            content: {
              text: editorContent,
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
            if (tab === Tab.GENERAL) {
              onNext(tab);
            } else {
              handleSubmit();
            }
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
                  status={tabState[Tab.GENERAL]}
                  value={Tab.GENERAL}
                  className="max-w-[200px] truncate"
                >
                  General
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.CONTENT]}
                  value={Tab.CONTENT}
                  className="max-w-[200px] truncate"
                >
                  Blog Content
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
                    <Heading className="text-xl">General Information</Heading>
                    <Badge color="blue">{form.watch("status")}</Badge>
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
                    <Form.Label>Content</Form.Label>
                    <Form.Control>
                      <Textarea placeholder="Blog description"  {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />


              <Form.Field
                control={form.control}
                name="status"
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
            <ProgressTabs.Content value={Tab.CONTENT} className="size-full overflow-y-auto">
              <div className="flex flex-col gap-y-4 p-8">
                <div className="flex items-center gap-x-2 mb-4">
                  <Heading className="text-xl">Blog Content</Heading>
                </div>
                <div className="p-4">
                  <TextEditor
                    editorContent={editorContent}
                    setEditorContent={setEditorContent}
                    onEditorReady={(editor) => {
                      editorInstanceRef.current = editor;
                      // Extract first image on initial load
                      const imageUrl = extractFirstImageUrl(editor);
                      if (imageUrl && imageUrl !== firstImageUrl) {
                        setFirstImageUrl(imageUrl);
                        form.setValue('blocks.0.content.image.content', imageUrl);
                      }
                    }}
                  />
                </div>
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
            {tab === Tab.CONTENT ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={onBack}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="small"
                  isLoading={form.formState.isSubmitting}
                >
                  Create
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="small"
                onClick={() => onNext(tab)}
              >
                Continue
              </Button>
            )}
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
