/**
 * @file Admin API route for a single partner task
 * @description Read/update a specific task assigned to a partner (e.g. correcting
 * estimated/actual cost after creation).
 * @module API/Admin/Partners/Tasks
 */
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { updateTaskWorkflow } from "../../../../../../workflows/tasks/update-task";
import { AdminUpdatePartnerTaskReq } from "../validators";

async function getPartnerTask(req: MedusaRequest) {
    const { id: partnerId, taskId } = req.params;

    const task = await refetchEntity({
        entity: "task",
        idOrFilter: taskId,
        scope: req.scope,
        fields: ["*", "partners.*"],
    });

    const isLinked =
        task &&
        Array.isArray((task as any).partners) &&
        (task as any).partners.some((p: any) => p.id === partnerId);

    if (!task || !isLinked) {
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Task ${taskId} was not found for partner ${partnerId}`
        );
    }

    return task;
}

/**
 * GET /admin/partners/[id]/tasks/[taskId]
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const task = await getPartnerTask(req);
    return res.json({ task });
};

/**
 * PATCH /admin/partners/[id]/tasks/[taskId]
 * Updates a task assigned to a partner — title/description/priority/dates,
 * as well as the estimated/actual cost fields captured at creation time.
 */
export const PATCH = async (
    req: MedusaRequest<AdminUpdatePartnerTaskReq>,
    res: MedusaResponse
) => {
    const { taskId } = req.params;
    await getPartnerTask(req);

    const body = req.validatedBody;
    const { result } = await updateTaskWorkflow(req.scope).run({
        input: {
            id: taskId,
            update: {
                title: body.title,
                description: body.description,
                status: body.status,
                priority: body.priority,
                start_date: body.start_date
                    ? (typeof body.start_date === "string" ? new Date(body.start_date) : body.start_date)
                    : undefined,
                end_date: body.end_date
                    ? (typeof body.end_date === "string" ? new Date(body.end_date) : body.end_date)
                    : undefined,
                estimated_cost: body.estimated_cost,
                actual_cost: body.actual_cost,
                cost_currency: body.cost_currency,
                cost_type: body.cost_type,
                metadata: body.metadata,
            },
        },
    });

    const task = Array.isArray(result) ? result[0] : result;
    return res.json({ task });
};
