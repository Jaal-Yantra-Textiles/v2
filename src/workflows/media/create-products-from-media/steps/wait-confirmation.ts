import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationMediaProductStep = createStep(
    {
        name: "wait-confirmation-media-product-step",
        async: true, // This makes it a long-running step that waits for external signal
    },
    async () => {
        return new StepResponse({
            confirmed: true,
        })
    }
)
