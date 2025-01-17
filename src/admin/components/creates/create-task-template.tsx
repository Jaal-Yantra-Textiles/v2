import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Heading, Input, Text, toast, Select, Checkbox, Popover } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateTaskTemplate } from "../../hooks/api/task-templates";
import { useTaskTemplateCategories } from "../../hooks/api/task-template-categories";
import { useState } from "react";

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
  category: z.object({
    id: z.string().optional(),
    name: z.string().min(2, "Category name is required"),
    description: z.string().optional(),
  }),
});

type TaskTemplateFormData = z.infer<typeof taskTemplateSchema>;

export const CreateTaskTemplateComponent = () => {
  const [categorySearch, setCategorySearch] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  
  const form = useForm<TaskTemplateFormData>({
    defaultValues: {
      name: "",
      description: "",
      priority: "medium",
      estimated_duration: 60,
      eventable: true,
      notifiable: true,
      message_template: "",
      category: {
        id: "",
        name: "",
        description: "",
      },
    },
    resolver: zodResolver(taskTemplateSchema),
  });

  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreateTaskTemplate();
  const { categories = [] } = useTaskTemplateCategories(
    categorySearch ? { name: categorySearch } : undefined
  );

  const handleSubmit = form.handleSubmit(async (data) => {
    const categoryData = data.category;
    const existingCategory = categories.find(c => c.name.toLowerCase() === categoryData.name.toLowerCase());

    const payload = {
      ...data,
      category: existingCategory ? { id: existingCategory.id } : categoryData,
      required_fields: {},
      metadata: {
        type: "default",
      },
    };

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
    form.setValue("category", {
      id: category.id,
      name: category.name,
      description: category.description || "",
    });
    setCategorySearch("");
    setShowCategoryDropdown(false);
  };

  const handleCategoryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    form.setValue("category.name", value);
    setCategorySearch(value);
    setShowCategoryDropdown(true);
  };

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
                      <Select>
                        <Select.Trigger>
                          <Select.Value placeholder="Select priority" />
                        </Select.Trigger>
                        <Select.Content {...field}>
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
                name="category.name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Category</Form.Label>
                    <div className="relative">
                      <Form.Control>
                        <Input 
                          autoComplete="off" 
                          {...field}
                          onChange={handleCategoryInputChange}
                          placeholder="Type to search or create new category"
                        />
                      </Form.Control>
                      {showCategoryDropdown && categories.length > 0 && (
                        <div 
                          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-base shadow-lg"
                        >
                          {categories.map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              className="w-full px-4 py-2 text-left text-sm hover:bg-ui-bg-base-hover focus:bg-ui-bg-base-hover focus:outline-none"
                              onClick={() => handleCategorySelect(category)}
                            >
                              {category.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Form.ErrorMessage />
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
                      checked={form.watch("eventable")}
                      onCheckedChange={(checked) => form.setValue("eventable", checked)}
                    />
                    <Text className="text-sm">Enable Events</Text>
                  </div>

                  <div className="flex items-center gap-x-2">
                    <Checkbox 
                      checked={form.watch("notifiable")}
                      onCheckedChange={(checked) => form.setValue("notifiable", checked)}
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
