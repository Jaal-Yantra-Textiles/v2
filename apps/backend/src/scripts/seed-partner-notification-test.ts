/**
 * Test seed: drop a fake notification into a partner's bell.
 *
 * Use this to verify the partner bell end-to-end without building a
 * full visual flow first. The script takes a partner uuid (positional
 * or via --partner-id) and pushes one entry through createPartnerNotification.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-notification-test.ts <partner_uuid>
 *
 * Or:
 *   npx medusa exec ./src/scripts/seed-partner-notification-test.ts \
 *     --partner-id=<uuid> \
 *     --title="Order placed" \
 *     --description="Customer Jane bought 3 items" \
 *     --url=/orders/abc \
 *     --count=3
 *
 * `--count=N` emits N rows so you can see the unread badge increment.
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPartnerNotification } from "../lib/notifications/create-partner-notification"

type Args = {
  partner_id: string
  title: string
  description: string
  url: string | null
  count: number
}

function parseArgs(rawArgs: string[]): Args {
  let partner_id = ""
  let title = `Test notification ${new Date().toLocaleTimeString()}`
  let description = "Triggered by seed-partner-notification-test.ts"
  let url: string | null = null
  let count = 1

  // First positional that isn't a flag → partner_id (when --partner-id absent)
  for (const arg of rawArgs) {
    if (arg.startsWith("--partner-id=")) partner_id = arg.slice("--partner-id=".length)
    else if (arg.startsWith("--title=")) title = arg.slice("--title=".length)
    else if (arg.startsWith("--description=")) description = arg.slice("--description=".length)
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length)
    else if (arg.startsWith("--count=")) count = Math.max(1, Number(arg.slice("--count=".length)) || 1)
    else if (!arg.startsWith("--") && !partner_id) partner_id = arg
  }

  return { partner_id, title, description, url, count }
}

export default async function seedPartnerNotificationTest({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const parsed = parseArgs(args ?? [])

  if (!parsed.partner_id) {
    logger.error(
      "Missing partner_id. Pass it as the first positional arg or via --partner-id=<uuid>.",
    )
    return
  }

  logger.info(
    `Sending ${parsed.count} test notification(s) to partner=${parsed.partner_id}...`,
  )

  let success = 0
  for (let i = 0; i < parsed.count; i++) {
    const ok = await createPartnerNotification(container, {
      partner_id: parsed.partner_id,
      title: parsed.count > 1 ? `${parsed.title} (#${i + 1})` : parsed.title,
      description: parsed.description,
      url: parsed.url,
      trigger_type: "manual.test_seed",
      // Re-runs intentionally don't dedup — that lets you spam the bell
      // without changing the script. If you want dedup, append a stable
      // suffix to title and a matching idempotency_key.
    })
    if (ok) success++
  }

  logger.info(
    `Done. ${success}/${parsed.count} notification(s) created. Open the partner UI to verify the bell badge.`,
  )
}
