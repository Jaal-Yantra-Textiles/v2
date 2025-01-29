import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Heading,
  Text,
  toast,
  usePrompt,
  Input,
  Select,
  Textarea,
  IconButton,
  DatePicker,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { Plus, Minus, ChevronDown } from "@medusajs/icons";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useState } from "react";
import { useCreateDesignTask } from "../../hooks/api/design-tasks";

const TASK_PRIORITIES = ["low", "medium", "high"] as const;
const TASK_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
const DEPENDENCY_TYPES = ["blocking", "non_blocking", "subtask", "related"] as const;

const taskSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  due_date: z.date(),
  child_tasks: z.array(z.object({
    title: z.string().min(2, "Title is required"),
    description: z.string(),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    dependency_type: z.enum(DEPENDENCY_TYPES),
  })),
});

type TaskFormData = z.infer<typeof taskSchema>;

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
];

const dependencyOptions = [
  { value: "blocking", label: "Blocking" },
  { value: "non_blocking", label: "Non-blocking" },
  { value: "subtask", label: "Subtask" },
  { value: "related", label: "Related" },
];

export const CreateDesignTaskComponent = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { handleSuccess } = useRouteModal();
  const prompt = usePrompt();
  const [isMainTaskExpanded, setIsMainTaskExpanded] = useState(true);
  const { mutateAsync: createTask, isPending } = useCreateDesignTask(id!);

  const form = useForm<TaskFormData>({
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      due_date: new Date(),
      child_tasks: [],
    },
    resolver: zodResolver(taskSchema),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "child_tasks",
  });

  const handleAddSubtask = () => {
    append({
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      dependency_type: "subtask",
    });
    setIsMainTaskExpanded(false);
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    const res = await prompt({
      title: t("tasks.create.confirmTitle"),
      description: t("tasks.create.confirmDescription"),
      confirmText: t("actions.create"),
      cancelText: t("actions.cancel"),
    });

    if (!res) return;

    try {
      // Create a single task with child tasks
      const taskPayload = {
        type: "task" as const,
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        due_date: data.due_date,
        ...(data.child_tasks.length > 0 && { child_tasks: data.child_tasks }),
      };

      await createTask(taskPayload, {
        onSuccess: () => {
          toast.success(t("tasks.create.success"));
          handleSuccess(`/designs/${id}`);
        },
        onError: (error) => {
          toast.error(error.message);
        },
      });
    } catch (error) {
      console.error("Failed to create task:", error);
      toast.error(t("tasks.create.error"));
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div>
            <Heading>{t("tasks.create.title")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("tasks.create.subtitle")}
            </Text>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            {/* Main Task Section */}
            <div className="relative rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-x-2">
                  <IconButton
                    size="small"
                    variant="transparent"
                    onClick={() => setIsMainTaskExpanded(!isMainTaskExpanded)}
                  >
                    <ChevronDown 
                      className={`text-ui-fg-subtle transition-transform ${
                        isMainTaskExpanded ? "" : "-rotate-90"
                      }`}
                    />
                  </IconButton>
                  <Heading level="h3">{t("tasks.mainTask")}</Heading>
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleAddSubtask}
                >
                  <Plus className="mr-2" />
                  {t("tasks.addSubtask")}
                </Button>
              </div>

              {/* Main Task Form Fields */}
              <div
                className={`grid gap-6 transition-all duration-200 ${
                  isMainTaskExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="">
                  <div className="flex flex-col gap-y-6 max-w-3xl mx-auto px-4">
                    <div className="space-y-6">
                      <Form.Field
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <Form.Item className="max-w-2xl">
                            <Form.Label>{t("fields.title")}</Form.Label>
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
                            <Form.Label>{t("fields.description")}</Form.Label>
                            <Form.Control>
                              <Textarea className="min-h-[100px]" {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                      <Form.Field
                        control={form.control}
                        name="priority"
                        render={({ field: { value, onChange, ...rest } }) => (
                          <Form.Item>
                            <Form.Label>{t("fields.priority")}</Form.Label>
                            <Form.Control>
                              <Select 
                                value={value} 
                                onValueChange={onChange}
                                {...rest}
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
                        name="status"
                        render={({ field: { value, onChange, ...rest } }) => (
                          <Form.Item>
                            <Form.Label>{t("fields.status")}</Form.Label>
                            <Form.Control>
                              <Select 
                                value={value} 
                                onValueChange={onChange}
                                {...rest}
                              >
                                <Select.Trigger>
                                  <Select.Value placeholder="Select status" />
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
                    </div>

                    <Form.Field
                      control={form.control}
                      name="due_date"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{t("fields.dueDate")}</Form.Label>
                          <Form.Control>
                            <DatePicker
                              value={field.value}
                              onChange={(date) => {
                                field.onChange(date);
                              }}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Child Tasks Section */}
            {fields.length > 0 && (
              <div className="relative flex flex-col gap-y-6 pl-8">
                {/* Vertical connector from main task */}
                <div className="absolute -top-8 left-8 h-full w-0.5 border-l-2 border-dashed border-ui-border-base" />

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="relative ml-8"
                  >
                    {/* Horizontal connector to child task */}
                    <div className="absolute -left-8 top-4 h-0.5 w-8 border-t-2 border-dashed border-ui-border-base" />
                    
                    {/* Circle connector */}
                    <div className="absolute -left-9 top-3 h-3 w-3 rounded-full border-2 border-ui-border-base bg-ui-bg-base" />
                    
                    <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <Form.Field
                            control={form.control}
                            name={`child_tasks.${index}.title`}
                            render={({ field }) => (
                              <Form.Item>
                                <Form.Label>{t("fields.title")}</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" {...field} />
                                </Form.Control>
                                <Form.ErrorMessage />
                              </Form.Item>
                            )}
                          />

                          <div className="mt-4">
                            <Form.Field
                              control={form.control}
                              name={`child_tasks.${index}.description`}
                              render={({ field }) => (
                                <Form.Item>
                                  <Form.Label>{t("fields.description")}</Form.Label>
                                  <Form.Control>
                                    <Textarea {...field} />
                                  </Form.Control>
                                  <Form.ErrorMessage />
                                </Form.Item>
                              )}
                            />
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-x-4">
                            <Form.Field
                              control={form.control}
                              name={`child_tasks.${index}.priority`}
                              render={({ field: { value, onChange, ...rest } }) => (
                                <Form.Item>
                                  <Form.Label>{t("fields.priority")}</Form.Label>
                                  <Form.Control>
                                    <Select 
                                      value={value} 
                                      onValueChange={onChange}
                                      {...rest}
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
                              name={`child_tasks.${index}.dependency_type`}
                              render={({ field: { value, onChange, ...rest } }) => (
                                <Form.Item>
                                  <Form.Label>{t("fields.dependencyType")}</Form.Label>
                                  <Form.Control>
                                    <Select 
                                      value={value} 
                                      onValueChange={onChange}
                                      {...rest}
                                    >
                                      <Select.Trigger>
                                        <Select.Value placeholder="Select dependency type" />
                                      </Select.Trigger>
                                      <Select.Content>
                                        {dependencyOptions.map((option) => (
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
                          </div>

                          <div className="mt-4">
                            <Form.Field
                              control={form.control}
                              name={`child_tasks.${index}.status`}
                              render={({ field: { value, onChange, ...rest } }) => (
                                <Form.Item>
                                  <Form.Label>{t("fields.status")}</Form.Label>
                                  <Form.Control>
                                    <Select 
                                      value={value} 
                                      onValueChange={onChange}
                                      {...rest}
                                    >
                                      <Select.Trigger>
                                        <Select.Value placeholder="Select status" />
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
                          </div>
                        </div>

                        <IconButton
                          size="small"
                          variant="transparent"
                          onClick={() => remove(index)}
                          className="ml-2"
                        >
                          <Minus className="text-ui-fg-subtle" />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              {t("actions.create")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
