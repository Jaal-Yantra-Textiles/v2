import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { AdminDesignTask, TaskPriority, TaskStatus, useUpdateDesignTask } from "../../hooks/api/design-tasks";
import { DatePicker } from "@medusajs/ui";

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  start_date: z.date().nullable().optional(),
  end_date: z.date().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

type TaskFormData = z.infer<typeof taskSchema>;

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type EditTaskFormProps = {
  task: AdminDesignTask;
  designId: string;
};

const DatePickerField = ({ value, onChange }: any) => (
  <DatePicker
    value={value}
    onChange={(date) => {
      onChange(date);
    }}
  />
);

export const EditTaskForm = ({ task, designId }: EditTaskFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateDesignTask(designId, task.id);

  const handleSubmit = async (data: TaskFormData) => {
    await mutateAsync(
      {
        title: data.title,
        description: data.description,
        status: data.status as TaskStatus,
        priority: data.priority as TaskPriority,
        due_date: data.end_date as Date,
        metadata: data.metadata,
      },
      {
        onSuccess: ({ task }) => {
          toast.success(
            t("tasks.updateSuccess", {
              defaultValue: "Task {{title}} updated successfully",
              title: task.title,
            })
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const fields: FieldConfig<TaskFormData>[] = [
    {
      name: "title",
      type: "text",
      label: t("fields.title", "Title"),
      required: true,
    },
    {
      name: "description",
      type: "text",
      label: t("fields.description", "Description"),
    },
    {
      name: "status",
      type: "select",
      label: t("fields.status", "Status"),
      options: statusOptions,
      gridCols: 1
    },
    {
      name: "priority",
      type: "select",
      label: t("fields.priority", "Priority"),
      options: priorityOptions,
      gridCols: 1
    },
    {
      name: "start_date",
      type: "custom",
      label: t("fields.startDate", "Start Date"),
      customComponent: DatePickerField,
      gridCols: 1
    },
    {
      name: "end_date",
      type: "custom",
      label: t("fields.dueDate", "Due Date"),
      customComponent: DatePickerField,
      gridCols: 1
    },
  ];

  const defaultValues: Partial<TaskFormData> = {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    start_date: task.start_date ? new Date(task.start_date) : null,
    end_date: task.end_date ? new Date(task.end_date) : null,
    metadata: task.metadata,
  };

  return (
    <DynamicForm<TaskFormData>
      fields={fields}
      onSubmit={handleSubmit}
      defaultValues={defaultValues}
      customValidation={taskSchema}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
