import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import { syncImapPlatforms } from "./lib/sync-imap-platforms"

type SyncInboundEmailsInput = {
  count?: number
}

type SyncResult = {
  synced: number
  skipped: number
  total_fetched: number
  providers_synced: number
  errors?: string[]
}

// Sync every mailbox of every active IMAP platform (the same pass the
// 5-minute job runs, #2377 S1). Throws only when nothing is configured.
const syncEmailsFromPlatformsStep = createStep(
  "sync-emails-from-platforms",
  async (input: { count: number }, { container }) => {
    try {
      return new StepResponse((await syncImapPlatforms(container, { count: input.count })) as SyncResult)
    } catch (err: any) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, err.message)
    }
  }
)

export const syncInboundEmailsWorkflow = createWorkflow(
  "sync-inbound-emails",
  (input: SyncInboundEmailsInput) => {
    const count = input.count ?? 50

    const failureNotification = transform({ input }, (data) => [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Inbound Email Sync Failed",
          description: `Failed to sync inbound emails (requested ${data.input.count ?? 50} emails).`,
        },
      },
    ])
    notifyOnFailureStep(failureNotification)

    const result = syncEmailsFromPlatformsStep({ count })

    const successNotification = transform({ result }, (data) => [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Inbound Email Sync Complete",
          description: `Synced ${data.result.synced} new email(s), skipped ${data.result.skipped} duplicate(s) across ${data.result.providers_synced} provider(s).`,
        },
      },
    ])
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(result)
  }
)
