import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { Button, Heading, Input, Text, toast, Select, Checkbox, Tooltip } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateTaskTemplate, CreateAdminTaskTemplatePayload } from "../../hooks/api/task-templates";
import { useTaskTemplateCategories } from "../../hooks/api/task-template-categories";
import { useState, useEffect, useRef } from "react";
import { PlusMini, InformationCircleSolid } from "@medusajs/icons";

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

const taskTemplateSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  estimated_duration: z.number().min(1, "Duration must be at least 1 minute"),
  eventable: z.boolean(),
  notifiable: z.boolean(),
  message_template: z.string(),
  // Updated to match API expectations - category can be a simple string
  category_name: z.string().min(2, "Category name is required"),
});

type TaskTemplateFormData = z.infer<typeof taskTemplateSchema>;

export const CreateTaskTemplateComponent = () => {
  const [categorySearch, setCategorySearch] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const form = useForm<TaskTemplateFormData>({
    defaultValues: {
      name: "",
      description: "",
      priority: "medium",
      estimated_duration: 60,
      eventable: true,
      notifiable: true,
      message_template: "",
      category_name: "",
    },
    resolver: zodResolver(taskTemplateSchema),
  });

  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreateTaskTemplate();
  const { categories = [], isLoading: isCategoriesLoading } = useTaskTemplateCategories(
    categorySearch ? { name: categorySearch } : undefined
  );

  const handleSubmit = form.handleSubmit(async (data) => {
    const categoryName = data.category_name;
    const existingCategory = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());

    // Create the payload with all required fields
    const payload: CreateAdminTaskTemplatePayload = {
      name: data.name,
      description: data.description,
      priority: data.priority, // This will now correctly pass the selected priority
      estimated_duration: data.estimated_duration,
      eventable: data.eventable,
      notifiable: data.notifiable,
      message_template: data.message_template,
      required_fields: {},
      metadata: {
        type: "default",
      },
    };
    
    // Add the appropriate category information based on whether it's new or existing
    if (existingCategory) {
      payload.category_id = existingCategory.id;
    } else {
      payload.category = categoryName;
    }

    await mutateAsync(payload, {
      onSuccess: ({ task_template }) => {
        toast.success(`Task Template created successfully: ${task_template.name}`);
        handleSuccess(`/settings/task-templates/${task_template.id}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  });

  const handleCategorySelect = (category: typeof categories[0]) => {
    form.setValue("category_name", category.name);
    setCategorySearch("");
    setShowCategoryDropdown(false);
  };

  const handleCategoryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    form.setValue("category_name", value);
    
    // Clear any existing timeout to prevent multiple rapid searches
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Set a small timeout to debounce the search (150ms is usually good for typing)
    searchTimeoutRef.current = setTimeout(() => {
      setCategorySearch(value);
    }, 150);
    
    // Always show dropdown when typing
    setShowCategoryDropdown(true);
  };
  
  // Handle keyboard events for the category input
  const handleCategoryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: any) => {
    // If Enter is pressed and there's an exact match, select it
    if (e.key === 'Enter' && field.value) {
      e.preventDefault();
      const exactMatch = categories.find(
        category => category.name.toLowerCase() === field.value.toLowerCase()
      );
      
      if (exactMatch) {
        handleCategorySelect(exactMatch);
      }
    }
  };
  
  // Check if the current category name exists in the categories list
  useEffect(() => {
    const categoryName = form.watch("category_name");
    if (categoryName && categoryName.trim() !== "") {
      const exists = categories.some(
        (category) => category.name.toLowerCase() === categoryName.toLowerCase()
      );
      setIsNewCategory(!exists);
      
      // Keep dropdown open for new categories
      if (!exists) {
        setShowCategoryDropdown(true);
      }
      
      // Hide dropdown if there's no search term
      if (!categorySearch) {
        setShowCategoryDropdown(false);
      }
    } else {
      setIsNewCategory(false);
      setShowCategoryDropdown(false);
    }
  }, [form.watch("category_name"), categories, categorySearch]);

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-col overflow-hidden"
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
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              Create
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Task Template</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Define a new task template to standardize your workflow
              </Text>
            </div>
            
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Template Name</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
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
                    <Form.Label optional>Description</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Priority</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select priority" />
                        </Select.Trigger>
                        <Select.Content>
                          {priorityOptions.map((option) => (
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
                name="category_name"
                render={({ field }) => (
                  <Form.Item className="relative">
                    <div className="flex items-center justify-between">
                      <Form.Label>Category</Form.Label>
                      {isNewCategory && field.value && (
                        <Tooltip content="This is a new category that will be created automatically">
                          <div className="flex items-center text-xs text-ui-fg-interactive gap-1 cursor-help">
                            <InformationCircleSolid className="w-3 h-3" />
                            <span>New category</span>
                          </div>
                        </Tooltip>
                      )}
                    </div>
                    <Form.Control>
                      <Input 
                        autoComplete="off" 
                        value={field.value}
                        onChange={(e) => {
                          field.onChange(e);
                          handleCategoryInputChange(e);
                        }}
                        onKeyDown={(e) => handleCategoryKeyDown(e, field)}
                        onFocus={() => setShowCategoryDropdown(true)}
                        className={isNewCategory ? "border-ui-border-interactive" : ""}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                    
                    {/* Category dropdown - positioned below the input field */}
                    {showCategoryDropdown && (
                      <div className="absolute z-10 mt-1 w-full rounded-md bg-ui-bg-base shadow-lg top-full left-0">
                        <div className="max-h-60 overflow-auto rounded-md py-1 text-base">
                          {isCategoriesLoading ? (
                            <div className="px-4 py-2 text-ui-fg-subtle">
                              Loading categories...
                            </div>
                          ) : categories.length > 0 ? (
                            (() => {
                              // Check for exact match first
                              const exactMatch = categories.find(
                                category => category.name.toLowerCase() === categorySearch.toLowerCase()
                              );
                              
                              // If there's an exact match, only show that one
                              if (exactMatch && categorySearch) {
                                return (
                                  <div
                                    key={exactMatch.id}
                                    className="cursor-pointer px-4 py-2 hover:bg-ui-bg-base-hover bg-ui-bg-base-hover"
                                    onClick={() => handleCategorySelect(exactMatch)}
                                  >
                                    <span className="font-medium text-ui-fg-interactive">{exactMatch.name}</span>
                                    <div className="text-xs text-ui-fg-subtle mt-1">Press Enter to select</div>
                                  </div>
                                );
                              }
                              
                              // Otherwise show all matches with highlighting
                              return categories.map((category) => {
                                // Create highlighted text by splitting the category name based on the search term
                                const searchTerm = categorySearch.toLowerCase();
                                const categoryName = category.name;
                                const lowerCaseName = categoryName.toLowerCase();
                                const matchIndex = lowerCaseName.indexOf(searchTerm);
                                
                                // Skip items that don't match the search term
                                if (matchIndex === -1 && searchTerm) {
                                  return null;
                                }
                                
                                let beforeMatch = "";
                                let match = "";
                                let afterMatch = "";
                                
                                if (matchIndex >= 0 && searchTerm) {
                                  beforeMatch = categoryName.substring(0, matchIndex);
                                  match = categoryName.substring(matchIndex, matchIndex + searchTerm.length);
                                  afterMatch = categoryName.substring(matchIndex + searchTerm.length);
                                } else {
                                  // If no match or empty search, just show the full name
                                  beforeMatch = categoryName;
                                }
                                
                                return (
                                  <div
                                    key={category.id}
                                    className="cursor-pointer px-4 py-2 hover:bg-ui-bg-base-hover"
                                    onClick={() => handleCategorySelect(category)}
                                  >
                                    {matchIndex >= 0 && searchTerm ? (
                                      <>
                                        {beforeMatch}
                                        <span className="font-medium text-ui-fg-interactive">{match}</span>
                                        {afterMatch}
                                      </>
                                    ) : (
                                      categoryName
                                    )}
                                  </div>
                                );
                              }).filter(Boolean);
                            })()
                          ) : categorySearch ? (
                            <div className="px-4 py-2 text-ui-fg-subtle flex items-center gap-1">
                              <PlusMini className="w-3 h-3" />
                              <span>No matches - will create new category</span>
                            </div>
                          ) : (
                            <div className="px-4 py-2 text-ui-fg-subtle">
                              Type to search or create new category
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {isNewCategory && field.value && !showCategoryDropdown && (
                      <div className="flex items-center text-xs text-ui-fg-subtle mt-1 gap-1">
                        <PlusMini className="w-3 h-3" />
                        <span>This category will be created automatically when you submit the form.</span>
                      </div>
                    )}
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="estimated_duration"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Estimated Duration (minutes)</Form.Label>
                    <Form.Control>
                      <Input 
                        type="number" 
                        autoComplete="off"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="message_template"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Message Template</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="flex flex-col gap-y-2">
                <Text className="text-ui-fg-subtle text-sm">Notifications</Text>
                <div className="flex flex-col gap-y-2">
                  <div className="flex items-center gap-x-2">
                    <Checkbox 
                      checked={form.watch("eventable") || false}
                      onCheckedChange={(checked: boolean) => form.setValue("eventable", checked)}
                    />
                    <Text className="text-sm">Enable Events</Text>
                  </div>

                  <div className="flex items-center gap-x-2">
                    <Checkbox 
                      checked={form.watch("notifiable") || false}
                      onCheckedChange={(checked: boolean) => form.setValue("notifiable", checked)}
                    />
                    <Text className="text-sm">Enable Notifications</Text>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
