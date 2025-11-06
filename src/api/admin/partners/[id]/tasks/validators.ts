import { z } from "zod";
import { Status, PriorityLevel } from "../../../../../workflows/tasks/create-task";

// Schema for child tasks (subtasks)
const childTaskSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    status: z.nativeEnum(Status).optional(),
    priority: z.nativeEnum(PriorityLevel).optional(),
    start_date: z.string().or(z.date()).optional(),
    end_date: z.string().or(z.date()).optional(),
    metadata: z.record(z.any()).optional(),
});

/**
 * Validator for creating a task for a partner
 */
export const AdminCreatePartnerTaskReq = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    status: z.nativeEnum(Status).optional(),
    priority: z.nativeEnum(PriorityLevel).optional(),
    end_date: z.string().or(z.date()).optional(),
    start_date: z.string().or(z.date()).optional(),
    template_names: z.array(z.string()).optional(),
    eventable: z.boolean().optional(),
    notifiable: z.boolean().optional(),
    message: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    child_tasks: z.array(childTaskSchema).optional(),
    dependency_type: z.enum(["blocking", "related", "subtask"]).optional(),
});

export type AdminCreatePartnerTaskReq = z.infer<typeof AdminCreatePartnerTaskReq>;
