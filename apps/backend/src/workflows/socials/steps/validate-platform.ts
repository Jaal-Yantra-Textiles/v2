import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 2: Validate Platform
 * 
 * Extracts and validates platform information.
 * Determines if this is a FBINSTA (Facebook & Instagram) platform.
 */
export const validatePlatformStep = createStep(
  "validate-platform",
  async (input: { platform: any }) => {
    const platformName = (input.platform.name || "").toLowerCase()
    const isFBINSTA = platformName === "fbinsta" || platformName === "facebook & instagram"

    console.log(`[Validate Platform] ✓ Platform: ${platformName}, FBINSTA: ${isFBINSTA}`)

    return new StepResponse({
      platform_name: platformName,
      is_fbinsta: isFBINSTA,
    })
  }
)
