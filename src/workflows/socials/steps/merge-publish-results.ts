import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 10: Merge Publish Results
 * 
 * Merges new publish results with previous attempts.
 * This is important for retry scenarios where we want to preserve
 * successful publishes from previous attempts.
 * 
 * Logic:
 * - If a platform was published in this attempt, replace its previous result
 * - If a platform wasn't published (e.g., smart retry skipped it), keep previous result
 * - Add any new platforms that weren't in previous results
 */
export const mergePublishResultsStep = createStep(
  "merge-publish-results",
  async (input: { results: any[]; previous_results: any[] }) => {
    const mergedResults = [...input.previous_results]

    input.results.forEach((newResult: any) => {
      const existingIndex = mergedResults.findIndex(
        (r: any) => r.platform === newResult.platform
      )

      if (existingIndex >= 0) {
        // Replace previous result for this platform
        mergedResults[existingIndex] = newResult
        console.log(`[Merge Results] Updated result for ${newResult.platform}`)
      } else {
        // Add new result
        mergedResults.push(newResult)
        console.log(`[Merge Results] Added new result for ${newResult.platform}`)
      }
    })

    console.log(`[Merge Publish Results] ✓ Merged ${input.results.length} new results with ${input.previous_results.length} previous`)

    return new StepResponse({ merged_results: mergedResults })
  }
)
