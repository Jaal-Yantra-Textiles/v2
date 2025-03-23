import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import createDesignFromLLMWorkflow from "../../../../workflows/designs/create-design-from-llm";
import { refetchDesign } from "../helpers";
import { CreateDesignLLM } from "../validators";

export const POST = async (
    req: MedusaRequest<CreateDesignLLM>,
    res: MedusaResponse,
) => {
    const { result, errors } = await createDesignFromLLMWorkflow(req.scope).run({
        input: req.validatedBody,
    });

    if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
    }

    const design = await refetchDesign(
        result.id,
        req.scope,
        ['*']
    );

    

    res.status(201).json({ design });
}
  
