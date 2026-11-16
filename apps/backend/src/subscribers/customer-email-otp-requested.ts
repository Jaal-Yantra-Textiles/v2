import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"

import {
  EMAIL_OTP_REQUESTED_EVENT,
  maskEmail,
  type EmailOtpRequestedEvent,
} from "../modules/email-otp-auth/service"
import { sendCustomerLoginCodeEmailWorkflow } from "../workflows/email/workflows/send-customer-login-code-email"

/**
 * Emails the one-time sign-in code issued by the `email-otp` auth provider
 * (#2543). The provider stores only the code's hash; this event is the one
 * place the plaintext travels, straight into the email.
 *
 * Best-effort: the buyer has already been told "code sent". A failure is
 * logged (without the code) and the buyer can press "Resend".
 */
export default async function customerEmailOtpRequestedHandler({
  event: { data },
  container,
}: SubscriberArgs<EmailOtpRequestedEvent>) {
  const logger = container.resolve("logger")
  if (!data?.email || !data?.code) return

  try {
    await sendCustomerLoginCodeEmailWorkflow(container).run({
      input: {
        email: data.email,
        code: data.code,
        expires_in_minutes: data.expires_in_minutes,
      },
    })
    logger.info(`[email-otp] sign-in code emailed to ${maskEmail(data.email)}`)
  } catch (e: any) {
    logger.error(
      `[email-otp] failed to email a sign-in code to ${maskEmail(data.email)}: ${e?.message ?? e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: EMAIL_OTP_REQUESTED_EVENT,
}
