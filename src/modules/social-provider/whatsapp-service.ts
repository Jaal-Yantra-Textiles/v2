import { MedusaError } from "@medusajs/utils"

const GRAPH_API_VERSION = "v21.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface WhatsAppMessageResponse {
  messaging_product: string
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

export interface WhatsAppInteractiveButton {
  type: "reply"
  reply: { id: string; title: string }
}

export interface WhatsAppInteractiveMessage {
  type: "button" | "list"
  header?: { type: "text"; text: string }
  body: { text: string }
  footer?: { text: string }
  action: {
    buttons?: WhatsAppInteractiveButton[]
    button?: string
    sections?: Array<{
      title: string
      rows: Array<{ id: string; title: string; description?: string }>
    }>
  }
}

export default class WhatsAppService {
  private readonly phoneNumberId: string
  private readonly accessToken: string
  private readonly webhookVerifyToken: string
  private readonly appSecret: string

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || ""
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ""
    this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ""
    this.appSecret = process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET || ""
  }

  getWebhookVerifyToken(): string {
    return this.webhookVerifyToken
  }

  getAppSecret(): string {
    return this.appSecret
  }

  /**
   * Send a text message to a WhatsApp number
   */
  async sendTextMessage(to: string, text: string): Promise<WhatsAppMessageResponse> {
    return this.sendRequest({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    })
  }

  /**
   * Send an interactive button message (max 3 buttons)
   */
  async sendInteractiveMessage(
    to: string,
    interactive: WhatsAppInteractiveMessage
  ): Promise<WhatsAppMessageResponse> {
    return this.sendRequest({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive,
    })
  }

  /**
   * Send a template message (required for initiating conversations)
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string = "en",
    components?: Array<{
      type: "header" | "body" | "button"
      parameters: Array<{ type: string; text?: string; image?: { link: string } }>
      sub_type?: string
      index?: number
    }>
  ): Promise<WhatsAppMessageResponse> {
    const payload: any = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    }

    if (components?.length) {
      payload.template.components = components
    }

    return this.sendRequest(payload)
  }

  /**
   * Send a production run assignment notification with interactive buttons
   */
  async sendProductionRunAssignment(
    to: string,
    data: {
      designName: string
      runId: string
      runType: string
      quantity?: number
      notes?: string
      webUrl?: string
    }
  ): Promise<WhatsAppMessageResponse> {
    const lines = [
      `📋 *New Production Run Assigned*`,
      ``,
      `*Design:* ${data.designName}`,
      `*Run ID:* ${data.runId}`,
      `*Type:* ${data.runType}`,
    ]

    if (data.quantity) {
      lines.push(`*Quantity:* ${data.quantity}`)
    }
    if (data.notes) {
      lines.push(``, `*Notes:* ${data.notes}`)
    }
    if (data.webUrl) {
      lines.push(``, `🔗 ${data.webUrl}`)
    }

    lines.push(``, `_Reply with an action below or update from the web._`)

    return this.sendInteractiveMessage(to, {
      type: "button",
      body: { text: lines.join("\n") },
      action: {
        buttons: [
          { type: "reply", reply: { id: `accept_${data.runId}`, title: "✅ Accept" } },
          { type: "reply", reply: { id: `view_${data.runId}`, title: "📄 View Details" } },
        ],
      },
    })
  }

  /**
   * Send production run status actions based on current state
   */
  async sendRunActions(
    to: string,
    runId: string,
    status: string,
    designName: string
  ): Promise<WhatsAppMessageResponse> {
    const buttons: WhatsAppInteractiveButton[] = []
    let bodyText = ""

    switch (status) {
      case "in_progress": {
        bodyText = `✅ *Run Accepted:* ${runId}\n*Design:* ${designName}\n\nYou can now start working on this run.`
        buttons.push(
          { type: "reply", reply: { id: `start_${runId}`, title: "▶️ Start" } },
        )
        break
      }
      case "started": {
        bodyText = `▶️ *Run Started:* ${runId}\n*Design:* ${designName}\n\nWhen you're done, mark it as finished.`
        buttons.push(
          { type: "reply", reply: { id: `finish_${runId}`, title: "🏁 Finish" } },
          { type: "reply", reply: { id: `media_${runId}`, title: "📸 Add Media" } },
        )
        break
      }
      case "finished": {
        bodyText = `🏁 *Run Finished:* ${runId}\n*Design:* ${designName}\n\nReady to complete with final details?`
        buttons.push(
          { type: "reply", reply: { id: `complete_${runId}`, title: "✔️ Complete" } },
        )
        break
      }
      default:
        bodyText = `Production run ${runId} status: ${status}`
    }

    if (buttons.length === 0) {
      return this.sendTextMessage(to, bodyText)
    }

    return this.sendInteractiveMessage(to, {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    })
  }

  /**
   * Send a completion prompt asking for produced quantity
   */
  async sendCompletionPrompt(
    to: string,
    runId: string,
    designName: string
  ): Promise<WhatsAppMessageResponse> {
    return this.sendTextMessage(
      to,
      `✔️ *Completing Run:* ${runId}\n*Design:* ${designName}\n\n` +
      `Please reply with the produced quantity and any rejected count.\n\n` +
      `Format: \`complete ${runId} produced:100 rejected:5\`\n\n` +
      `Or just reply with the number produced: \`complete ${runId} 100\``
    )
  }

  /**
   * Send multiple run summary (when partner has multiple pending runs)
   */
  async sendRunsSummary(
    to: string,
    runs: Array<{ id: string; designName: string; status: string; runType: string }>
  ): Promise<WhatsAppMessageResponse> {
    if (runs.length === 0) {
      return this.sendTextMessage(to, "You have no active production runs at the moment.")
    }

    const lines = [
      `📋 *Your Active Production Runs (${runs.length})*`,
      ``,
    ]

    for (const run of runs.slice(0, 10)) {
      const statusEmoji = {
        sent_to_partner: "📩",
        in_progress: "🔄",
        started: "▶️",
        finished: "🏁",
      }[run.status] || "📋"
      lines.push(`${statusEmoji} *${run.id}* — ${run.designName} (${run.runType})`)
    }

    if (runs.length > 10) {
      lines.push(``, `_...and ${runs.length - 10} more. Check the web portal for full list._`)
    }

    lines.push(``, `_Reply with a run ID to see actions, e.g. \`status ${runs[0].id}\`_`)

    return this.sendTextMessage(to, lines.join("\n"))
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.sendRequest({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }).catch(() => {
      // Non-fatal — best effort
    })
  }

  private async sendRequest(payload: any): Promise<WhatsAppMessageResponse> {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "WhatsApp: WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required"
      )
    }

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `WhatsApp API error: ${resp.status} - ${JSON.stringify(err)}`
      )
    }

    return (await resp.json()) as WhatsAppMessageResponse
  }
}
