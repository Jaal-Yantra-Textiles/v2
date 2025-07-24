import {
    SubscriberArgs,
    type SubscriberConfig,
  } from "@medusajs/framework"
  import { sendPasswordResetWorkflow } from "../workflows/email/send-notification-email"
  
  export default async function resetPasswordTokenHandler({
    event: { data: {
      entity_id: email,
      token,
      actor_type,
    } },
    container,
  }: SubscriberArgs<{ entity_id: string, token: string, actor_type: string }>) {
    const urlPrefix = actor_type === "customer" ? 
      "https://cicilabel.com" : 
      "https://v3.jaalyantra.com/app"
  
    const resetUrl = `${urlPrefix}/reset-password?token=${token}&email=${email}`
  
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