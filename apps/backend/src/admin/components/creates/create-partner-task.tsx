import { useForm, useFieldArray } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Heading,
  Text,
  toast,
  Input,
  Select,
  Textarea,
  IconButton,
  DatePicker,
  Badge,
  Switch,
} from "@medusajs/ui";
import { useParams } from "react-router-dom";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { Plus, Minus, ChevronDown, ArrowRight } from "@medusajs/icons";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useState } from "react";
import { useAssignPartnerTask, useCreatePartnerTask } from "../../hooks/api/partner-tasks";

const TASK_PRIORITIES = ["low", "medium", "high"] as const;
const TASK_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
const EXECUTION_TYPES = ["sequential", "parallel", "conditional"] as const;

// Logical expression schema for task workflow
const logicalExpressionSchema = z.object({
  type: z.enum(EXECUTION_TYPES),
  description: z.string().optional(),
});

const taskStepSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  order: z.number(),
});

const taskSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  end_date: z.date().optional(),
  start_date: z.date().optional(),
  assign_immediately: z.boolean(),
  workflow_config: logicalExpressionSchema,
  steps: z.array(taskStepSchema).min(1, "At least one step is required"),
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

const executionTypeOptions = [
  { 
    value: "sequential", 
    label: "Sequential", 
    description: "Steps must be completed in order (Step 1 → Step 2 → Step 3)" 
  },
  { 
    value: "parallel", 
    label: "Parallel", 
    description: "All steps can be done at the same time" 
  },
  { 
    value: "conditional", 
    label: "Conditional", 
    description: "Steps depend on previous step outcomes" 
  },
];

export const CreatePartnerTaskComponent = () => {
  const { id: partnerId } = useParams();
  const { handleSuccess } = useRouteModal();
  const [isMainTaskExpanded, setIsMainTaskExpanded] = useState(true);
  const { mutateAsync: createTask, isPending: isCreating } = useCreatePartnerTask(partnerId!);
  const { mutateAsync: assignTask, isPending: isAssigning } = useAssignPartnerTask(partnerId!);

  const form = useForm<TaskFormData>({
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      end_date: undefined,
      start_date: undefined,
      assign_immediately: false,
      workflow_config: {
        type: "sequential",
        description: "",
      },
      steps: [
        {
          title: "",
          description: "",
          priority: "medium",
          status: "pending",
          order: 1,
        },
      ],
    },
    resolver: zodResolver(taskSchema),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "steps",
  });

  const workflowType = form.watch("workflow_config.type");
  const assignImmediately = form.watch("assign_immediately");

  const handleAddStep = () => {
    append({
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      order: fields.length + 1,
    });
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      // Prepare metadata with workflow configuration
      const metadata = {
        workflow_config: {
          type: data.workflow_config.type,
          description: data.workflow_config.description,
          steps: data.steps.map((step, index) => ({
            ...step,
            order: index + 1,
          })),
        },
      };

      // Create the task
      const taskPayload = {
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        end_date: data.end_date,
        start_date: data.start_date,
        metadata,
      };

      const createdTask = await createTask(taskPayload, {
        onError: (error: Error) => {
          toast.error(error.message);
          throw error;
        },
      });

      // If assign immediately is checked, trigger the assignment workflow
      if (data.assign_immediately && createdTask?.task?.id) {
        await assignTask(
          { taskId: createdTask.task.id },
          {
            onSuccess: () => {
              toast.success("Task created and assigned successfully with workflow");
              handleSuccess(`/partners/${partnerId}`);
            },
            onError: (error: Error) => {
              toast.warning(`Task created but assignment failed: ${error.message}`);
              handleSuccess(`/partners/${partnerId}`);
            },
          }
        );
      } else {
        toast.success("Task created successfully");
        handleSuccess(`/partners/${partnerId}`);
      }
    } catch (error) {
      console.error("Failed to create task:", error);
      toast.error("Failed to create task");
    }
  });

  const getWorkflowVisualization = () => {
    if (fields.length === 0) return null;

    switch (workflowType) {
      case "sequential":
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Badge size="small" className="bg-blue-100 text-blue-700">
                  Step {index + 1}
                </Badge>
                {index < fields.length - 1 && (
                  <ArrowRight className="text-ui-fg-subtle"/>
                )}
              </div>
            ))}
          </div>
        );
      case "parallel":
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {fields.map((field, index) => (
              <Badge key={field.id} size="small" className="bg-green-100 text-green-700">
                Step {index + 1}
              </Badge>
            ))}
          </div>
        );
      case "conditional":
        return (
          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Badge size="small" className="bg-purple-100 text-purple-700">
                  Step {index + 1}
                </Badge>
                {index < fields.length - 1 && (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    → If completed, proceed to Step {index + 2}
                  </Text>
                )}
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const isPending = isCreating || isAssigning;

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div>
            <Heading>Create Partner Task</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Create a task with workflow steps for the partner
            </Text>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[1000px] flex-col gap-y-8">
            {/* Main Task Section */}
            <div className="relative rounded-lg border border-ui-border-base bg-ui-bg-base p-8">
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
                  <Heading level="h3">Main Task Details</Heading>
                </div>
              </div>

              {/* Main Task Form Fields */}
              <div
                className={`grid gap-6 transition-all duration-200 ${
                  isMainTaskExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="flex flex-col gap-y-6">
                    <Form.Field
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>Task Title</Form.Label>
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
                          <Form.Label>Description</Form.Label>
                          <Form.Control>
                            <Textarea className="min-h-[100px]" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
                      <Form.Field
                        control={form.control}
                        name="priority"
                        render={({ field: { value, onChange, ...rest } }) => (
                          <Form.Item>
                            <Form.Label>Priority</Form.Label>
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
                            <Form.Label>Status</Form.Label>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
                      <Form.Field
                        control={form.control}
                        name="start_date"
                        render={({ field }) => (
                          <Form.Item>
                            <Form.Label>Start Date (Optional)</Form.Label>
                            <Form.Control>
                              <DatePicker
                                value={field.value}
                                onChange={(date) => field.onChange(date)}
                              />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />

                      <Form.Field
                        control={form.control}
                        name="end_date"
                        render={({ field }) => (
                          <Form.Item>
                            <Form.Label>Due Date (Optional)</Form.Label>
                            <Form.Control>
                              <DatePicker
                                value={field.value}
                                onChange={(date) => field.onChange(date)}
                              />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />
                    </div>

                    <Form.Field
                      control={form.control}
                      name="assign_immediately"
                      render={({ field: { value, onChange, ...rest } }) => (
                        <Form.Item>
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <Form.Label>Assign & Run Workflow Immediately</Form.Label>
                              <Text size="small" className="text-ui-fg-subtle mt-1">
                                Automatically assign this task to the partner and start the workflow
                              </Text>
                            </div>
                            <Form.Control>
                              <Switch
                                checked={value}
                                onCheckedChange={onChange}
                                {...rest}
                              />
                            </Form.Control>
                          </div>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Configuration Section */}
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle-hover p-6">
              <div className="mb-6">
                <Heading level="h3" className="mb-2">Workflow Configuration</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Define how the partner should execute the task steps
                </Text>
              </div>

              <Form.Field
                control={form.control}
                name="workflow_config.type"
                render={({ field: { value, onChange, ...rest } }) => (
                  <Form.Item>
                    <Form.Label>Execution Type</Form.Label>
                    <Form.Control>
                      <Select 
                        value={value} 
                        onValueChange={onChange}
                        {...rest}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select execution type" />
                        </Select.Trigger>
                        <Select.Content>
                          {executionTypeOptions.map((option) => (
                            <Select.Item key={option.value} value={option.value}>
                              <div className="flex flex-col">
                                <span className="font-medium">{option.label}</span>
                                <span className="text-xs text-ui-fg-subtle">{option.description}</span>
                              </div>
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="mt-4">
                <Form.Field
                  control={form.control}
                  name="workflow_config.description"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Workflow Instructions (Optional)</Form.Label>
                      <Form.Control>
                        <Textarea 
                          placeholder="Additional instructions for the partner on how to execute this workflow..."
                          {...field} 
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              {/* Workflow Visualization */}
              {fields.length > 0 && (
                <div className="mt-6 p-4 bg-ui-bg-base rounded-lg border border-ui-border-base">
                  <Text size="small" weight="plus" className="mb-3">
                    Workflow Preview:
                  </Text>
                  {getWorkflowVisualization()}
                </div>
              )}
            </div>

            {/* Task Steps Section */}
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <Heading level="h3">Task Steps</Heading>
                  <Text size="small" className="text-ui-fg-subtle mt-1">
                    Define the individual steps the partner needs to complete
                  </Text>
                  <div className="mt-3 p-3 bg-ui-bg-subtle rounded-md border border-ui-border-base">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      <strong>Note:</strong> These steps are stored as metadata within the main task. 
                      Partners can view and track progress on these steps, but they are not separate tasks. 
                      Step completion is managed through the task metadata.
                    </Text>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleAddStep}
                  type="button"
                >
                  <Plus className="mr-2" />
                  Add Step
                </Button>
              </div>

              <div className="flex flex-col gap-y-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="relative rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 mt-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ui-bg-base border border-ui-border-base">
                          <Text size="small" weight="plus">{index + 1}</Text>
                        </div>
                      </div>

                      <div className="flex-1 space-y-4">
                        <Form.Field
                          control={form.control}
                          name={`steps.${index}.title`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Step Title</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />

                        <Form.Field
                          control={form.control}
                          name={`steps.${index}.description`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Step Description</Form.Label>
                              <Form.Control>
                                <Textarea {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />

                        <div className="grid grid-cols-2 gap-x-4">
                          <Form.Field
                            control={form.control}
                            name={`steps.${index}.priority`}
                            render={({ field: { value, onChange, ...rest } }) => (
                              <Form.Item>
                                <Form.Label>Priority</Form.Label>
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
                            name={`steps.${index}.status`}
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
                        type="button"
                        className="flex-shrink-0"
                      >
                        <Minus className="text-ui-fg-subtle" />
                      </IconButton>
                    </div>
                  </div>
                ))}

                {fields.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Text size="small" className="text-ui-fg-subtle mb-4">
                      No steps added yet. Add at least one step to create the task.
                    </Text>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={handleAddStep}
                      type="button"
                    >
                      <Plus className="mr-2" />
                      Add First Step
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
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
              {assignImmediately ? "Create & Assign Task" : "Create Task"}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
