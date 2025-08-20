import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { AdminImageExtractionReq, AdminImageExtractionReqType } from "./validators";
import { imageExtractionMedusaWorkflow } from "../../../../workflows/ai/image-extraction";
import { extractAndCreateInventoryWorkflow } from "../../../../workflows/ai/extract-and-create-inventory";

export const POST = async (
  req: MedusaRequest<AdminImageExtractionReqType>,
  res: MedusaResponse
) => {
  try {
    // Validate input from JSON body
    const parsed = AdminImageExtractionReq.safeParse(
      (req as any).validatedBody || (req.body as AdminImageExtractionReqType)
    );
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ");
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body");
    }
    const body = parsed.data;

    // Conditionally run composite workflow for persistence
    if (body.persist) {
      const { result, errors } = await extractAndCreateInventoryWorkflow(req.scope).run({
        input: {
          image_url: body.image_url,
          entity_type: body.entity_type,
          notes: body.notes,
          threadId: body.threadId,
          resourceId: body.resourceId,
          hints: body.hints,
          verify: body.verify,
          persist: true,
          defaults: body.defaults,
        },
      })

      if (errors.length) {
        const msg = errors.map((e) => e.error?.message).filter(Boolean).join("; ")
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg || "Extraction + persistence failed")
      }

      return res.status(201).json({
        message: "Image processed and records created",
        result,
      })
    } else {
      const { result, errors } = await imageExtractionMedusaWorkflow(req.scope).run({
        input: {
          image_url: body.image_url,
          entity_type: body.entity_type,
          notes: body.notes,
          threadId: body.threadId,
          resourceId: body.resourceId,
          hints: body.hints,
          verify: body.verify,
          defaults: body.defaults,
        },
      })

      if (errors.length) {
        const msg = errors.map((e) => e.error?.message).filter(Boolean).join("; ")
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg || "Image extraction failed")
      }

      return res.status(200).json({
        message: "Image processed successfully",
        result,
      })
    }
  } catch (e) {
    const err = e as Error;
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500;
      return res.status(status).json({ message: err.message });
    }
    return res.status(500).json({ message: err.message || "Unexpected error" });
  }
};
