import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
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
  ProgressTabs,
} from "@medusajs/ui";
import { useParams } from "react-router-dom";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { Plus, Minus, ArrowRight } from "@medusajs/icons";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useState, useEffect } from "react";
import { useAssignPartnerTask, useCreatePartnerTask } from "../../hooks/api/partner-tasks";
import type { ProgressStatus } from "@medusajs/ui";

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
type TaskField = keyof TaskFormData;

enum Tab {
  DETAILS = "details",
  WORKFLOW = "workflow",
  STEPS = "steps",
}

type TabState = Record<Tab, ProgressStatus>;

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
  const { mutateAsync: createTask, isPending: isCreating } = useCreatePartnerTask(partnerId!);
  const { mutateAsync: assignTask, isPending: isAssigning } = useAssignPartnerTask(partnerId!);
  
  const [tab, setTab] = useState<Tab>(Tab.DETAILS);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.DETAILS]: "not-started",
    [Tab.WORKFLOW]: "not-started",
    [Tab.STEPS]: "not-started",
  });

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    mode: "onChange",
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
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "steps",
  });

  useEffect(() => {
    // Set initial tab state
    setTabState((prev) => ({
      ...prev,
      [Tab.DETAILS]: "in-progress",
    }));
  }, []);

  const handleTabChange = (newTab: Tab) => {
    // Allow navigation to already completed tabs or the current in-progress tab
    if (tabState[newTab] === "completed" || tabState[newTab] === "in-progress") {
      setTab(newTab);
    }
  };

  const handleNextTab = async (currentTab: Tab, nextTab: Tab, fieldsToValidate?: TaskField[]) => {
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
      setTabState((prev) => ({
        ...prev,
        [currentTab]: "in-progress",
      }));
    }
  };

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
      // Prepare metadata with workflow configuration (without steps - they're now child tasks)
      const metadata = {
        workflow_config: {
          type: data.workflow_config.type,
          description: data.workflow_config.description,
        },
      };

      // Prepare child tasks from steps
      const child_tasks = data.steps.map((step, index) => ({
        title: step.title,
        description: step.description,
        priority: step.priority,
        status: step.status,
        start_date: data.start_date, // Inherit from parent
        end_date: data.end_date, // Inherit from parent
        metadata: {
          order: index + 1,
          step_type: "subtask",
        },
      }));

      // Create the task with child tasks
      const taskPayload = {
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        end_date: data.end_date,
        start_date: data.start_date,
        metadata,
        child_tasks, // Pass child tasks to create parent-child relationship
        dependency_type: "subtask" as const,
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

    const workflowType = form.watch("workflow_config.type");
    
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <Badge size="small" color="blue">
              {form.watch(`steps.${index}.title`) || `Step ${index + 1}`}
            </Badge>
            {index < fields.length - 1 && (
              <ArrowRight className="text-ui-fg-subtle" />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
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
              <ProgressTabs.List className="flex w-full items-center justify-start overflow-x-auto whitespace-nowrap">
                <ProgressTabs.Trigger 
                  value={Tab.DETAILS} 
                  status={tabState.details} 
                  onClick={() => handleTabChange(Tab.DETAILS)}
                  className="flex-shrink-0"
                >
                  Task Details
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger 
                  value={Tab.WORKFLOW} 
                  status={tabState.workflow} 
                  onClick={() => handleTabChange(Tab.WORKFLOW)}
                  disabled={tabState.details !== 'completed' && tabState.workflow === 'not-started'}
                  className="flex-shrink-0"
                >
                  Workflow Config
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger 
                  value={Tab.STEPS} 
                  status={tabState.steps} 
                  onClick={() => handleTabChange(Tab.STEPS)}
                  disabled={(tabState.details !== 'completed' || tabState.workflow !== 'completed') && tabState.steps === 'not-started'}
                  className="flex-shrink-0"
                >
                  Task Steps
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            {/* Tab 1: Task Details */}
            <ProgressTabs.Content value={Tab.DETAILS} className="h-full overflow-hidden">
              <div className="flex h-full flex-col gap-y-8 overflow-y-auto px-4 py-6 sm:p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <Heading className="text-xl">Main Task Information</Heading>
                </div>

                <div className="flex flex-col gap-y-6">
                  <Form.Field
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Task Title</Form.Label>
                        <Form.Control>
                          <Input autoComplete="off" placeholder="e.g., Complete fabric dyeing process" {...field} />
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
                          <Textarea 
                            className="min-h-[120px]" 
                            placeholder="Provide detailed instructions for the partner..."
                            {...field} 
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
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
                        <div className="flex items-center justify-between p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
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
            </ProgressTabs.Content>

            {/* Tab 2: Workflow Configuration */}
            <ProgressTabs.Content value={Tab.WORKFLOW} className="h-full overflow-hidden">
              <div className="flex h-full flex-col gap-y-8 overflow-y-auto px-4 py-6 sm:p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <Heading className="text-xl">Workflow Configuration</Heading>
                </div>

                <div className="flex flex-col gap-y-6">
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

                  <Form.Field
                    control={form.control}
                    name="workflow_config.description"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Workflow Instructions (Optional)</Form.Label>
                        <Form.Control>
                          <Textarea 
                            className="min-h-[120px]"
                            placeholder="Additional instructions for the partner on how to execute this workflow..."
                            {...field} 
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                </div>
              </div>
            </ProgressTabs.Content>

            {/* Tab 3: Task Steps */}
            <ProgressTabs.Content value={Tab.STEPS} className="h-full overflow-hidden">
              <div className="flex h-full flex-col gap-y-6 overflow-hidden px-4 py-6 sm:p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <Heading className="text-xl">Task Steps</Heading>
                    <Text size="small" className="text-ui-fg-subtle mt-1">
                      Define the individual steps the partner needs to complete
                    </Text>
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

                <div className="p-3 bg-ui-bg-subtle rounded-md border border-ui-border-base">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    <strong>Note:</strong> These steps will be created as individual child tasks (subtasks). 
                    Partners can view, track, and update each step independently in their task detail page.
                  </Text>
                </div>

                {/* Workflow Visualization */}
                {fields.length > 0 && (
                  <div className="p-4 bg-ui-bg-base rounded-lg border border-ui-border-base">
                    <Text size="small" weight="plus" className="mb-3">
                      Workflow Preview:
                    </Text>
                    {getWorkflowVisualization()}
                  </div>
                )}

                <div className="flex flex-col gap-y-6 overflow-y-auto flex-1">
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="p-6 rounded-lg border border-ui-border-base bg-ui-bg-base"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <Badge size="small">Step {index + 1}</Badge>
                        {fields.length > 1 && (
                          <IconButton
                            size="small"
                            variant="transparent"
                            onClick={() => remove(index)}
                            type="button"
                          >
                            <Minus />
                          </IconButton>
                        )}
                      </div>

                      <div className="grid gap-4">
                        <Form.Field
                          control={form.control}
                          name={`steps.${index}.title`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Step Title</Form.Label>
                              <Form.Control>
                                <Input placeholder="e.g., Prepare materials" {...field} />
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
                              <Form.Label>Description</Form.Label>
                              <Form.Control>
                                <Textarea 
                                  placeholder="Detailed instructions for this step..."
                                  {...field} 
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                          <Form.Field
                            control={form.control}
                            name={`steps.${index}.priority`}
                            render={({ field: { value, onChange, ...rest } }) => (
                              <Form.Item>
                                <Form.Label>Priority</Form.Label>
                                <Form.Control>
                                  <Select value={value} onValueChange={onChange} {...rest}>
                                    <Select.Trigger>
                                      <Select.Value />
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
                                  <Select value={value} onValueChange={onChange} {...rest}>
                                    <Select.Trigger>
                                      <Select.Value />
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
                    </div>
                  ))}
                </div>
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          {/* Footer with conditional buttons based on current tab */}
          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              {tab === Tab.DETAILS && (
                <Button
                  type="button"
                  size="small"
                  onClick={() => handleNextTab(Tab.DETAILS, Tab.WORKFLOW, ["title", "description", "priority", "status"])}
                >
                  Continue
                </Button>
              )}
              {tab === Tab.WORKFLOW && (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.DETAILS)}
                  >
                    Back
                  </Button>
                  <Button
                    size="small"
                    type="button"
                    onClick={() => handleNextTab(Tab.WORKFLOW, Tab.STEPS, ["workflow_config"])}
                  >
                    Continue
                  </Button>
                </>
              )}
              {tab === Tab.STEPS && (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.WORKFLOW)}
                  >
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    size="small"
                    isLoading={isCreating || isAssigning}
                    disabled={isCreating || isAssigning}
                  >
                    Create Task
                  </Button>
                </>
              )}
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
