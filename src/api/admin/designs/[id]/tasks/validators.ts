import { z } from "zod"

// ============= Constants =============
const TASK_PRIORITIES = ["low", "medium", "high"] as const
const TASK_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const
const DEPENDENCY_TYPES = ["blocking", "non_blocking", "subtask", "related"] as const

// ============= Utilities =============
const dateTransformer = (val: unknown): Date | undefined => {
  if (typeof val === "string") {
    const date = new Date(val)
    return isNaN(date.getTime()) ? undefined : date
  }
  return val as Date | undefined
}

// ============= Base Schema =============
const BaseTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  due_date: z.preprocess(dateTransformer, z.date()).optional(),
  metadata: z.record(z.any()).optional(),
  template_names: z.array(z.string())
    .min(1, "At least one template name is required")
    .optional(),
})

// ============= Child Task Schema =============
const ChildTaskSchema = BaseTaskSchema.extend({
  dependency_type: z.enum(DEPENDENCY_TYPES).optional()
})

// ============= Parent Task Schema =============
const ParentTaskSchema = BaseTaskSchema.extend({
  parent_task_id: z.string().optional(),
  child_tasks: z.array(ChildTaskSchema).optional(),
  dependency_type: z.enum(DEPENDENCY_TYPES).optional()
}).refine(
  (data) => !data.template_names || data.template_names.length > 0,
  {
    message: "template_names array cannot be empty",
    path: ["template_names"]
  }
)

// ============= API Request Schemas =============
const TemplateBasedCreation = BaseTaskSchema.extend({
  template_names: z.array(z.string())
    .min(1, "At least one template name is required"),
  metadata: z.record(z.any()).optional(),
  child_tasks: z.array(ChildTaskSchema).optional(),
  dependency_type: z.enum(DEPENDENCY_TYPES).optional()
})

const MultipleTasksCreation = z.object({
  tasks: z.array(ParentTaskSchema)
    .min(1, "At least one task is required")
})

export const AdminPostDesignTasksReq = z.union([
  TemplateBasedCreation,
  ParentTaskSchema,
  MultipleTasksCreation
]).refine(
  (data) => {
    // Check template_names in all possible locations
    if ('template_names' in data && 
        Array.isArray(data.template_names) && 
        data.template_names.length === 0) {
      return false
    }
    
    if ('tasks' in data && Array.isArray(data.tasks)) {
      return !data.tasks.some(task => 
        task.template_names && task.template_names.length === 0
      )
    }
    
    return true
  },
  {
    message: "Invalid template_names configuration",
    path: ["template_names"]
  }
)

// ============= Simplified Version =============
export const AdminPostDesignTasksSimplified = z.object({
  template_names: z.array(z.string())
    .min(1, "At least one template name is required")
    .transform(names => [...new Set(names)]), // Remove duplicates
  tasks: z.array(
    z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      due_date: z.string().datetime().optional(),
      assignee_id: z.string().optional(),
      parent_task_id: z.string().optional(),
      dependency_type: z.enum([...DEPENDENCY_TYPES, "parent"]).optional(),
      eventable: z.boolean().optional(),
      notifiable: z.boolean().optional(),
      metadata: z.record(z.any()).optional()
    })
  )
    .optional()
    .default([])
})

// ============= Type Exports =============
export type BaseTaskType = z.infer<typeof BaseTaskSchema>
export type ChildTaskType = z.infer<typeof ChildTaskSchema>
export type ParentTaskType = z.infer<typeof ParentTaskSchema>
export type AdminPostDesignTasksReqType = z.infer<typeof AdminPostDesignTasksReq>
export type AdminPostDesignTasksSimplifiedType = z.infer<typeof AdminPostDesignTasksSimplified>