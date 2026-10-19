import {
    SubscriberArgs,
    type SubscriberConfig,
  } from "@medusajs/framework"
  import { sendPasswordResetWorkflow } from "../workflows/email/send-notification-email"

  /**
   * Where each actor's reset link lands. Every app has its own
   * `/reset-password` page that calls `updateProvider(<actor>, …)`, so a link
   * to the wrong app cannot work: the admin page would try to reset a `user`
   * with an investor's token.
   */
  export const resetUrlPrefixFor = (actorType: string): string => {
    switch (actorType) {
      case "customer":
        return "https://cicilabel.com"
      case "partner":
        return "https://partner.jaalyantra.com"
      case "investor":
        return "https://invest.jaalyantra.com"
      default:
        return "https://v3.jaalyantra.com/app"
    }
  }

  export default async function resetPasswordTokenHandler({
    event: { data: {
      entity_id: email,
      token,
      actor_type,
    } },
    container,
  }: SubscriberArgs<{ entity_id: string, token: string, actor_type: string }>) {
    const resetUrl = `${resetUrlPrefixFor(actor_type)}/reset-password?token=${token}&email=${email}`
  
    // Execute the password reset email workflow
    await sendPasswordResetWorkflow(container).run({
      input: {
        email,
        resetUrl,
      },
    })
  }
  
  export const config: SubscriberConfig = {
    event: "auth.password_reset",
  }
