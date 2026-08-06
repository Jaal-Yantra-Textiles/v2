import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { resolveExportIgstForCountry } from "../modules/shipping-providers/export-igst"

/**
 * Export LUT expiry check (#1216).
 *
 * An LUT (GST form RFD-11) covers ONE financial year and must be re-furnished each
 * April. Nothing breaks loudly when it lapses — the resolver quietly reverts to
 * declaring IGST as paid and reclaimed ("C"), which is the SAFE outcome but also a
 * silent one: exports start costing working capital again and nobody is told.
 *
 * So this job exists to make the rollover visible in advance. It does NOT change
 * any declaration — expiry is already handled by the validity window, by design.
 * It only warns, at escalating urgency, so RFD-11 gets re-furnished before the FY
 * turns rather than after someone notices the cash impact.
 *
 * Notifies on the `feed` channel (the admin bell) via the generic `admin-ui`
 * template — no new email template to seed, and no recipient list to keep current.
 */

/** Warn from here in. Roughly the last 6 weeks of the financial year. */
const WARNING_DAYS = 45
/** Below this, say it more urgently. */
const URGENT_DAYS = 14

export default async function checkExportLutExpiry(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const resolution = await resolveExportIgstForCountry(container)

    // Nothing in force → already declaring the safe "C". There is no expiry to
    // warn about, and nagging about a LUT that was never filed would be noise.
    if (resolution.status !== "B") {
      logger.info(
        "[export-lut-check] No LUT in force; exports declare IGST paid and reclaimed (C). Nothing to warn about."
      )
      return
    }

    const days = resolution.days_until_expiry
    if (typeof days !== "number") {
      logger.warn(
        `[export-lut-check] LUT ${resolution.lut_arn} is in force but its expiry could not be read — check the recorded validity window.`
      )
      return
    }

    if (days > WARNING_DAYS) {
      logger.info(
        `[export-lut-check] LUT ${resolution.lut_arn} (FY ${resolution.financial_year}) valid for ${days} more days.`
      )
      return
    }

    const urgent = days <= URGENT_DAYS
    const title = urgent
      ? `Export LUT expires in ${days} day${days === 1 ? "" : "s"}`
      : `Export LUT expires in ${days} days`
    const description =
      `LUT ${resolution.lut_arn} (FY ${resolution.financial_year}) lapses in ${days} day${days === 1 ? "" : "s"}. ` +
      `Re-furnish RFD-11 on the GST portal for the next financial year and record it under Settings → Export LUT. ` +
      `When it expires, exports revert to paying IGST and reclaiming it — correct, but it ties up working capital on every shipment.`

    logger.warn(`[export-lut-check] ${title} — ${description}`)

    // Best-effort: a notification-provider problem must not fail the job, or a
    // transient outage would also cost us the log line above.
    try {
      const notificationService: any = container.resolve(Modules.NOTIFICATION)
      await notificationService.createNotifications({
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: { title, description },
      })
    } catch (e: any) {
      logger.warn(
        `[export-lut-check] Could not post the admin notification: ${e?.message}`
      )
    }
  } catch (e: any) {
    logger.error(`[export-lut-check] Error: ${e?.message}`)
  }
}

export const config = {
  name: "check-export-lut-expiry",
  // Weekly (Mondays, 07:00). An LUT lapses on a known date months ahead — a daily
  // check would just repeat the same warning 45 times.
  schedule: "0 7 * * 1",
}
