import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Feedback } from "../../../../../feedbacks/validators"
import { createFeedbackWithAiV2LinkWorkflow } from "../../../../../../../workflows/feedback/create-feedback-with-ai-v2-link"

export const POST = async (req: MedusaRequest<Feedback>, res: MedusaResponse) => {
  const runId = req.params.runId

  const { result } = await createFeedbackWithAiV2LinkWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      link_to: {
        run_id: runId,
      },
    } ,
  })

  return res.status(201).json({ feedback: result.feedback })
}
