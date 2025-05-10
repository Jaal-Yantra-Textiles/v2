import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { Subscriber, SubscriberBatch } from "../types"

export const prepareSubscriberBatchesStepId = "prepare-subscriber-batches"

// Number of subscribers to process in each batch
const BATCH_SIZE = 50

/**
 * This step prepares batches of subscribers for processing.
 * It divides the subscribers into smaller batches to avoid overwhelming
 * the email service and to allow for better error handling.
 *
 * @example
 * const batches = prepareSubscriberBatchesStep({ 
 *   subscribers: [...], 
 *   blogData: {...}, 
 *   emailConfig: { subject: "New Blog", customMessage: "Check out our latest post" } 
 * })
 */
export const prepareSubscriberBatchesStep = createStep(
  prepareSubscriberBatchesStepId,
  async (input: { 
    subscribers: Subscriber[], 
    blogData: any, 
    emailConfig: { subject: string, customMessage?: string }
  }) => {
    const { subscribers, blogData, emailConfig } = input
    
    console.log(`Preparing batches for ${subscribers.length} subscribers with batch size ${BATCH_SIZE}`)
  
      // Divide subscribers into batches
      const batches: SubscriberBatch[] = []
      
      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batchSubscribers = subscribers.slice(i, i + BATCH_SIZE)
        
        batches.push({
          subscribers: batchSubscribers,
          blogData,
          emailConfig
        })
      }
      
      console.log(`Created ${batches.length} batches for processing`)
      
      return new StepResponse(batches)
    }
)
