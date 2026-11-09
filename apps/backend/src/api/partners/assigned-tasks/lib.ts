import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"

/**
 * The partner-facing task lookup every assigned-tasks route runs before
 * touching a task: the task plus its linked partners, so the route can
 * authorize the caller.
 *
 * query.index is the primary read (it can filter into linked-module
 * fields), but it answers from the INDEX ENGINE, which lags the module.
 * Dev's sync stalled for months and every task created since 404'd as
 * "Task not found" although the row exists and query.graph reads it fine;
 * the production-run-task-updated subscriber already treats the index as
 * optional the same way. A task an admin dispatched seconds ago must never
 * 404 for the partner it was sent to.
 *
 * So: index first, remote-joiner graph as the fallback. Returns the task
 * with a partners array, or null when the task genuinely does not exist.
 */
export const fetchTaskWithPartners = async (
    container: MedusaContainer,
    taskId: string,
): Promise<any | null> => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    let task: any = null
    try {
        const { data } = await query.index({
            entity: "task",
            fields: ["*", "partners.*"],
            filters: { id: taskId },
        })
        task = data?.[0] ?? null
    } catch {
        // Index unreadable — not a verdict on the task; fall through.
    }

    if (!task) {
        const { data } = await query.graph({
            entity: "task",
            fields: ["*", "partners.id", "partners.name"],
            filters: { id: taskId },
        })
        task = data?.[0] ?? null
    }

    return task
}
