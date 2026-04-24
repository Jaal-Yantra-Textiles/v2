import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"
import { toast } from "sonner"
import { DatePicker } from "@medusajs/ui"

import { DynamicForm, type FieldConfig } from "../common/dynamic-form"
import { useRouteModal } from "../modal/use-route-modal"
import {
  AdminProductionRunTask,
  useUpdateProductionRunTask,
} from "../../hooks/api/production-runs"

const taskSchema = z.object({
  description: z.string().optional(),
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled", "accepted", "blocked"])
    .optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  start_date: z.date().nullable().optional(),
  end_date: z.date().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

type TaskFormData = z.infer<typeof taskSchema>

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "accepted", label: "Accepted" },
  { value: "blocked", label: "Blocked" },
]

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

const DatePickerField = ({ value, onChange }: any) => (
  <DatePicker value={value} onChange={(date) => onChange(date)} />
)

interface EditProductionRunTaskFormProps {
  task: AdminProductionRunTask
  runId: string
}

export const EditProductionRunTaskForm = ({
  task,
  runId,
}: EditProductionRunTaskFormProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateProductionRunTask(runId, task.id)

  const handleSubmit = async (data: TaskFormData) => {
    await mutateAsync(
      {
        description: data.description,
        status: data.status,
        priority: data.priority,
        start_date: data.start_date ?? undefined,
        end_date: data.end_date ?? undefined,
        metadata: data.metadata,
      },
      {
        onSuccess: ({ task: updated }) => {
          toast.success(
            t("tasks.updateSuccess", {
              defaultValue: "Task {{title}} updated successfully",
              title: updated?.title || task.title || task.id,
            })
          )
          handleSuccess()
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  const fields: FieldConfig<TaskFormData>[] = [
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
      gridCols: 1,
    },
    {
      name: "priority",
      type: "select",
      label: t("fields.priority", "Priority"),
      options: priorityOptions,
      gridCols: 1,
    },
    {
      name: "start_date",
      type: "custom",
      label: t("fields.startDate", "Start Date"),
      customComponent: DatePickerField,
      gridCols: 1,
    },
    {
      name: "end_date",
      type: "custom",
      label: t("fields.dueDate", "Due Date"),
      customComponent: DatePickerField,
      gridCols: 1,
    },
  ]

  const defaultValues: Partial<TaskFormData> = {
    description: task.description,
    status: task.status as TaskFormData["status"],
    priority: task.priority as TaskFormData["priority"],
    start_date: task.start_date ? new Date(task.start_date) : null,
    end_date: task.end_date ? new Date(task.end_date) : null,
    metadata: (task.metadata as Record<string, any>) ?? undefined,
  }

  return (
    <DynamicForm<TaskFormData>
      fields={fields}
      onSubmit={handleSubmit}
      defaultValues={defaultValues}
      customValidation={taskSchema}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  )
}
