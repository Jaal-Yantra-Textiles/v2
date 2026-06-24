import {
  MedusaStoreRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import { getStoreFromPublishableKey } from "../helpers"
import { sendRegionRequestAdminEmailWorkflow } from "../../../workflows/email/workflows/send-region-request-admin-email"
import {
  buildRegionRequestAdminEmailData,
  resolveRegionRequestRecipient,
} from "../../../workflows/email/workflows/region-request-admin-email-lib"

/**
 * POST /store/contact-region-request
 *
 * Storefront-facing endpoint for the "We don't ship here yet" fallback.
 * A visitor whose country isn't covered by any of the partner's
 * regions (or whose region exists but has no price in the variant's
 * currency) sees a contact form on the product page; submitting it
 * lands here.
 *
 * Behavior
 *   Resolves the partner store via the storefront's publishable key,
 *   then creates a feed-channel notification so the partner sees the
 *   request in admin. No partner-email send in v1 — the admin feed is
 *   the lowest-coupling integration and avoids spamming partners
 *   before they've opted into per-channel routing.
 *
 *   Validation is light: name + email required, message + country
 *   code + product handle optional. We trust the storefront to send
 *   sane values; abuse vectors here are typical contact-form spam
 *   which we'll add rate-limiting / captcha for later if it becomes
 *   a problem.
 *
 * Why a Medusa notification vs. a new table
 *   Notifications already power the admin "Activity feed" and the
 *   email-provider integrations the partner has set up. Reusing
 *   them means a region-request shows up in the same UI as every
 *   other partner-relevant event — no new admin surface to build.
 *   When/if we want a structured "leads" view, we can promote this
 *   into its own model with a one-line migration.
 */
export const POST = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as Record<string, any>
  const name = String(body.name ?? "").trim()
  const email = String(body.email ?? "").trim()
  const message = body.message ? String(body.message).trim() : ""
  const countryCode = body.country_code
    ? String(body.country_code).trim().toLowerCase()
    : ""
  const productHandle = body.product_handle
    ? String(body.product_handle).trim()
    : ""

  if (!name || !email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "name and email are required"
    )
  }
  // Cheap email format gate — full RFC check is overkill, this just
  // catches obvious typos / empty submits.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "email is not a valid address"
    )
  }

  // Best-effort store resolution. If the publishable key isn't bound
  // to a store we still log the request (admin sees it) but flag
  // the missing store in the metadata so triage knows it's unrouted.
  let storeId: string | undefined
  let storeName: string | undefined
  try {
    const store = await getStoreFromPublishableKey(
      req.publishable_key_context!,
      req.scope
    )
    storeId = store?.id
    storeName = store?.name
  } catch {
    // swallow — we still create the notification
  }

  const notificationService = req.scope.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const title = countryCode
    ? `Region request: customer in ${countryCode.toUpperCase()}`
    : "Region request: storefront contact"

  const description = [
    `${name} <${email}> can't shop your storefront from`,
    countryCode ? `${countryCode.toUpperCase()}.` : "their location.",
    productHandle ? `Product: ${productHandle}.` : "",
    message ? `Message: ${message}` : "",
  ]
    .filter(Boolean)
    .join(" ")

  const notification = await notificationService.createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: {
      title,
      description,
      metadata: {
        kind: "region_request",
        store_id: storeId ?? null,
        store_name: storeName ?? null,
        country_code: countryCode || null,
        product_handle: productHandle || null,
        name,
        email,
        message: message || null,
        received_at: new Date().toISOString(),
      },
    },
  })

  // Best-effort admin email alert (#576 slice C). The feed notification above
  // is the source of truth; emailing an ops/admin inbox is a courtesy on top of
  // it. Anything that can fail here (no recipient configured, missing
  // `region-request-admin` template row, provider error) is swallowed so the
  // storefront submission always succeeds.
  let emailed = false
  try {
    const recipient = resolveRegionRequestRecipient(
      process.env as Record<string, string | undefined>
    )
    if (!recipient) {
      logger.info(
        "[contact-region-request] No admin recipient configured (REGION_REQUEST_NOTIFY_EMAIL) — skipping email"
      )
    } else {
      const emailData = buildRegionRequestAdminEmailData({
        name,
        email,
        message,
        countryCode,
        productHandle,
        storeId,
        storeName,
        receivedAt: new Date().toISOString(),
      })

      const run = await sendRegionRequestAdminEmailWorkflow(req.scope).run({
        input: { to: recipient.email, data: emailData },
        throwOnError: false,
      })

      if (run?.errors?.length) {
        logger.warn(
          `[contact-region-request] Admin email workflow reported errors: ${run.errors
            .map((e: any) => e?.error?.message || e?.message)
            .join("; ")}`
        )
      } else {
        emailed = true
      }
    }
  } catch (err) {
    logger.warn(
      `[contact-region-request] Admin email send failed (non-fatal): ${
        (err as Error)?.message
      }`
    )
  }

  res.json({
    id: notification?.id,
    received: true,
    store_id: storeId ?? null,
    emailed,
  })
}
