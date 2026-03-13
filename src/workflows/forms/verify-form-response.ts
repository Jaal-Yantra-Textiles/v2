import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../modules/forms"
import FormsService from "../../modules/forms/service"

export type VerifyFormResponseInput = {
  response_id: string
  code: string
}

const fetchAndValidateFormResponseStep = createStep(
  "fetch-and-validate-form-response",
  async (input: VerifyFormResponseInput, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const responses = await forms.listFormResponses(
      { id: input.response_id },
      { take: 1 }
    )

    const response = responses?.[0]

    if (!response) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Form response not found"
      )
    }

    if (response.status !== "pending_verification") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Response is already verified or processed"
      )
    }

    if (
      !response.verification_expires_at ||
      new Date(response.verification_expires_at) < new Date()
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Verification code has expired"
      )
    }

    if (response.verification_code !== input.code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid verification code"
      )
    }

    return new StepResponse(response)
  }
)

const promoteFormResponseStep = createStep(
  "promote-form-response",
  async (input: { response_id: string }, { container }) => {
    const forms: FormsService = container.resolve(FORMS_MODULE)

    const updated = await forms.updateFormResponses({
      id: input.response_id,
      status: "new" as any,
      verification_code: null,
      verification_expires_at: null,
    })

    return new StepResponse(updated)
  }
)

export const verifyFormResponseWorkflow = createWorkflow(
  "verify-form-response",
  (input: VerifyFormResponseInput) => {
    fetchAndValidateFormResponseStep(input)

    const updated = promoteFormResponseStep({
      response_id: input.response_id,
    })

    return new WorkflowResponse(updated)
  }
)
