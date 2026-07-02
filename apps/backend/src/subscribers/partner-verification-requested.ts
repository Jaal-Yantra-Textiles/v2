import {
  SubscriberArgs,
  type SubscriberConfig,
} from "@medusajs/framework"
import { sendPartnerVerificationEmailWorkflow } from "../workflows/email/send-notification-email"
import {
  buildPartnerVerificationEmail,
  type VerificationRequestedEvent,
} from "../workflows/email/lib/build-partner-verification-email"

/**
 * Handles Medusa's native `auth.verification_requested` event (2.16+).
 *
 * Only partner+emailpass verification is enabled (see
 * `authVerificationsPerActor` in medusa-config), so every event routed here is
 * a partner email verification. Sends the one-time code via the custom email
 * module. Best-effort: a failure here must not break registration, so we log
 * and swallow.
 */
export default async function partnerVerificationRequestedHandler({
  event: { data },
  container,
}: SubscriberArgs<VerificationRequestedEvent>) {
  const logger = container.resolve("logger")

  try {
    const { to, verifyUrl, expiresMinutes } =
      buildPartnerVerificationEmail(data)

    await sendPartnerVerificationEmailWorkflow(container).run({
      input: {
        email: to,
        verifyUrl,
        expiresMinutes,
      },
    })

    logger.info(
      `[partner-verification] sent verification email to ${to}`
    )
  } catch (e: any) {
    logger.error(
      `[partner-verification] failed to send verification email: ${e?.message ?? e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "auth.verification_requested",
}
