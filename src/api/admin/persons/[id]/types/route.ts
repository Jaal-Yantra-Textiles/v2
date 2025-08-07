import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { refetchPersonType } from "./helpers";
import { AdminPostPersonTypesReq } from "./validators";
import associatePersonTypesWorkflow from "../../../../../workflows/persons/associate-person-types";

export const POST = async(req: MedusaRequest, res: MedusaResponse) => {
    const { id } = req.params

    // Validate person exists
    const personExist = await refetchEntity(
        "person",
        id,
        req.scope,
        ["id"]
    )

    if (!personExist) { 
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Person with id "${id}" not found`
        );
    }

    // Validate request body and remove duplicates
    const originalBody = req.body as { personTypeIds?: string[] };
    const { personTypeIds } = AdminPostPersonTypesReq.parse(req.body);
    
    // Check if duplicates were removed
    const hasDuplicates = originalBody.personTypeIds?.length !== personTypeIds.length;

    // Check if all personTypes exist
    await refetchPersonType(personTypeIds, req.scope);

    const { result:list } = await associatePersonTypesWorkflow(req.scope).run({
        input: {
            personId: id,
            typeIds: personTypeIds
        }
    })
    return res.status(200).json({
        personTypesLink: {
            list,
            count: list[0].length
        },
        message: `Person ${id} successfully associated with ${list[0].length} types${hasDuplicates ? ' (duplicate IDs were removed)' : ''}`,
        originalCount: originalBody.personTypeIds?.length ?? 0,
        processedCount: personTypeIds.length
    })
}