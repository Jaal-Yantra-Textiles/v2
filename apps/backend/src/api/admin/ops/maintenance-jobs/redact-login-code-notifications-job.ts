import { Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import {
  REDACTED_LOGIN_CODE,
  redactLoginCode,
} from "../../../../workflows/email/workflows/send-customer-login-code-email-lib"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_SCAN = 5000

const paramsSchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_SCAN).optional().default(1000),
})

/**
 * #2543 — scrub the plaintext sign-in code from login-code emails sent before
 * the send step started redacting it (#2548). Each row's `data` holds the code
 * plus the rendered subject/HTML embedding it; all copies become "••••••".
 *
 * Harmless to sign-in: the email-otp provider checks a scrypt hash on the auth
 * identity, never this row. Idempotent: rows already redacted are skipped.
 * The job's own output never contains a code.
 */
export const redactLoginCodeNotificationsJob: MaintenanceJob = {
  id: "redact-login-code-notifications",
  label: "Redact sign-in codes from the email log",
  description:
    `Replace the plaintext design-studio sign-in code in old customer-login-code notification rows (code, subject, HTML) with ${REDACTED_LOGIN_CODE} (#2543). Sign-in is unaffected — codes are verified against a hash on the auth identity. Rows already redacted are skipped. Bounded scan (default 1000, max ${MAX_SCAN}).`,
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max notification rows to scan (default 1000, max ${MAX_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { limit } = paramsSchema.parse(params)
    const notifications: any = container.resolve(Modules.NOTIFICATION)

    const rows: any[] = await notifications.listNotifications(
      { template: "customer-login-code" },
      { take: limit, order: { created_at: "ASC" } }
    )

    const changes: MaintenanceChange[] = []
    const updates: Array<{ id: string; data: Record<string, any> }> = []
    let alreadyClean = 0

    for (const row of rows) {
      const code = row.data?.code
      if (typeof code !== "string" || !code || code === REDACTED_LOGIN_CODE) {
        alreadyClean++
        continue
      }
      updates.push({ id: row.id, data: redactLoginCode(row.data, code) })
      changes.push({
        entity: "notification",
        id: row.id,
        field: "data.code",
        before: "(plaintext code)",
        after: REDACTED_LOGIN_CODE,
        note: `sent ${new Date(row.created_at).toISOString()}`,
      })
    }

    const errors: Array<{ id: string; message: string }> = []
    if (!dry_run && updates.length) {
      try {
        await notifications.updateNotifications(updates)
      } catch (e: any) {
        errors.push({ id: "notification", message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would redact" : "Redacted"
    return {
      job_id: redactLoginCodeNotificationsJob.id,
      dry_run,
      applied: !dry_run && updates.length > 0 && !errors.length,
      summary: `${verb} the sign-in code in ${updates.length} of ${rows.length} login-code email row(s); ${alreadyClean} already clean`,
      changes,
      errors,
    }
  },
}
