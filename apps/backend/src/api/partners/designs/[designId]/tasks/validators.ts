import { z } from "@medusajs/framework/zod"
import { PriorityLevel, Status } from "../../../../../workflows/tasks/create-task"

/**
 * Partner-side create-design-tasks body schema. Mirrors the admin schema
 * (`POST /admin/designs/:id/tasks`, `AdminPostDesignTasksReq`) EXACTLY so the
 * partner wire contract is identical — only the auth/ownership scope differs
 * (enforced in the route via `assertPartnerOwnsDesign`).
 *
 * Note: there is intentionally NO assignee/partner field — task creation only
 * attaches tasks (optionally from shared admin task-templates) to the partner's
 * OWN design, so there is no cross-tenant vector to gate.
 */

// ============= Constants =============
const TASK_PRIORITIES = ["low", "medium", "high"] as const
const DEPENDENCY_TYPES = ["blocking", "non_blocking", "subtask", "related"] as const
const CHILD_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "accepted",
] as const

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
  priority: z.nativeEnum(PriorityLevel).optional(),
  status: z.nativeEnum(Status).optional(),
  due_date: z.preprocess(dateTransformer, z.date()).optional(),
  start_date: z
    .preprocess(dateTransformer, z.date())
    .optional()
    .default(() => new Date()),
  metadata: z.record(z.string(), z.any()).optional(),
})

// ============= Child Task Schema =============
const ChildTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(CHILD_TASK_STATUSES).optional(),
  dependency_type: z.enum(DEPENDENCY_TYPES),
})

// ============= Template Based Creation Schema =============
const TemplateBasedCreation = z.object({
  template_names: z
    .array(z.string())
    .min(1, "At least one template name is required"),
  child_tasks: z.array(ChildTaskSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  dependency_type: z.enum(DEPENDENCY_TYPES).optional(),
})

// ============= Parent Task Schema =============
const ParentTaskSchema = BaseTaskSchema.extend({
  template_names: z.array(z.string()).optional(),
  parent_task_id: z.string().optional(),
  child_tasks: z.array(ChildTaskSchema).optional(),
  dependency_type: z.enum(DEPENDENCY_TYPES).optional(),
})

// ============= Multiple Tasks Creation Schema =============
const MultipleTasksCreation = z.object({
  tasks: z.array(ParentTaskSchema).min(1, "At least one task is required"),
})

// Export the schema (discriminated union — identical to admin)
export const PartnerPostDesignTasksReq = z.discriminatedUnion("type", [
  TemplateBasedCreation.extend({ type: z.literal("template") }),
  ParentTaskSchema.extend({ type: z.literal("task") }),
  MultipleTasksCreation.extend({ type: z.literal("multiple") }),
])

export type PartnerPostDesignTasksReqType = z.infer<
  typeof PartnerPostDesignTasksReq
>
