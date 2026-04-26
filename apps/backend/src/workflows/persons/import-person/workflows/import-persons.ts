import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  waitConfirmationPersonImportStep,
  groupPersonsForBatchStep,
  parsePersonCsvStep,
} from "../steps"
import { batchPersonsWorkflow } from "./batch-persons"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"

export const importPersonsWorkflowId = "import-persons"
/**
 * This workflow starts a person import from a CSV file in the background.
 * 
 * The workflow only starts the import, but you'll have to confirm it using the Workflow Engine.
 * 
 * @example
 * To start the import of a CSV file:
 * 
 * ```ts
 * const { result, transaction: { transactionId } } = await importPersonsWorkflow(container)
 * .run({
 *   input: {
 *     // example CSV content
 *     fileContent: "First Name,Last Name,Email\nJohn,Doe,john@example.com",
 *     filename: "persons.csv",
 *   }
 * })
 * ```
 * 
 * You'll use the returned transactionId to confirm the import afterwards using the Workflow Engine.
 * 
 * @summary
 * 
 * Import persons from a CSV file.
 */
export const importPersonsWorkflow = createWorkflow(
  importPersonsWorkflowId,
  (
    input: WorkflowData<{
      fileContent: string
      filename: string
    }>
  ): WorkflowResponse<{
    toCreate: number
    toUpdate: number
  }> => {
    const persons = parsePersonCsvStep(input.fileContent)
    const batchRequest = groupPersonsForBatchStep(persons)

    const summary = transform({ batchRequest }, (data) => {
      return {
        toCreate: data.batchRequest.create.length,
        toUpdate: data.batchRequest.update.length,
      }
    })

    waitConfirmationPersonImportStep()

    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Person import",
            description: `Failed to import persons from file ${data.input.filename}`,
          },
        },
      ]
    })

    notifyOnFailureStep(failureNotification)

    batchPersonsWorkflow
      .runAsStep({ input: batchRequest })
      .config({ async: true, backgroundExecution: true })

    const notifications = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Person import",
            description: `Person import of file ${data.input.filename} completed successfully!`,
          },
        },
      ]
    })
    sendNotificationsStep(notifications)
    return new WorkflowResponse(summary)
  }
)
