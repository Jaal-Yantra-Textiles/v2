import { MedusaError } from "@medusajs/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../socials"
import { ENCRYPTION_MODULE } from "../encryption"
import type EncryptionService from "../encryption/service"
import type { EncryptedData } from "../encryption"
import type { WhatsAppPlatformApiConfig } from "../socials/types/whatsapp-platform"

const GRAPH_API_VERSION = "v21.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
  webhookVerifyToken: string
  appSecret: string
}

/**
 * Sender context for an outgoing WhatsApp message. Used by `withSender()`
 * to bind a service instance to a specific WhatsApp number when multiple
 * numbers are configured. `platformId` is the SocialPlatform row id.
 */
export interface WhatsAppSender {
  platformId?: string
  phoneNumberId: string
  accessToken: string
  appSecret?: string
  webhookVerifyToken?: string
}

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
  private phoneNumberId: string
  private accessToken: string
  private webhookVerifyToken: string
  private appSecret: string
  private appContainer_?: MedusaContainer
  private platformLoaded_ = false
  /**
   * SocialPlatform row id for this sender-bound instance. Null for the
   * default/env-var instance. Used by callers that need to persist the
   * sender identity (e.g. Conversation.default_sender_platform_id).
   */
  private senderPlatformId_: string | null = null

  constructor() {
    // Start with env vars as defaults
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || ""
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ""
    this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ""
    this.appSecret = process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET || ""
  }

  /**
   * Set the app-level Medusa container (NOT the module container).
   * Required for loading config from SocialPlatform in the database.
   * Callers pass req.scope (routes) or container (subscribers/steps).
   */
  setAppContainer(container: MedusaContainer): void {
    this.appContainer_ = container
  }

  /**
   * Load WhatsApp config from SocialPlatform (database).
   * Overwrites env-var defaults if a WhatsApp platform record exists.
   */
  private async loadFromPlatform(): Promise<void> {
    if (this.platformLoaded_ || !this.appContainer_) return
    this.platformLoaded_ = true

    try {
      const socialsService = this.appContainer_.resolve(SOCIALS_MODULE) as any
      const allComm = await socialsService.listSocialPlatforms(
        { category: "communication", status: "active" }
      )

      const list = Array.isArray(allComm) ? allComm : [allComm]
      const platform = list.find(
        (p: any) => p?.api_config?.provider === "whatsapp" || p?.name === "WhatsApp"
      )
      if (!platform) return

      const apiConfig = platform.api_config as Record<string, any> | null
      if (!apiConfig) return

      const encryptionService = this.appContainer_.resolve(ENCRYPTION_MODULE) as EncryptionService

      // Decrypt access token
      if (apiConfig.access_token_encrypted) {
        try {
          this.accessToken = encryptionService.decrypt(apiConfig.access_token_encrypted as EncryptedData)
        } catch {
          if (apiConfig.access_token) this.accessToken = apiConfig.access_token
        }
      } else if (apiConfig.access_token) {
        this.accessToken = apiConfig.access_token
      }

      // Decrypt app secret
      if (apiConfig.app_secret_encrypted) {
        try {
          this.appSecret = encryptionService.decrypt(apiConfig.app_secret_encrypted as EncryptedData)
        } catch {
          if (apiConfig.app_secret) this.appSecret = apiConfig.app_secret
        }
      } else if (apiConfig.app_secret) {
        this.appSecret = apiConfig.app_secret
      }

      // Decrypt webhook verify token
      if (apiConfig.webhook_verify_token_encrypted) {
        try {
          this.webhookVerifyToken = encryptionService.decrypt(apiConfig.webhook_verify_token_encrypted as EncryptedData)
        } catch {
          if (apiConfig.webhook_verify_token) this.webhookVerifyToken = apiConfig.webhook_verify_token
        }
      } else if (apiConfig.webhook_verify_token) {
        this.webhookVerifyToken = apiConfig.webhook_verify_token
      }

      // Phone number ID is not sensitive — stored as plaintext
      if (apiConfig.phone_number_id) {
        this.phoneNumberId = apiConfig.phone_number_id
      }
    } catch (err) {
      console.warn("[WhatsApp] Failed to load config from SocialPlatform, using env vars:", (err as Error).message)
    }
  }

  /**
   * Ensure config is loaded from DB before use
   */
  private async ensureConfig(): Promise<void> {
    if (!this.platformLoaded_) {
      await this.loadFromPlatform()
    }
  }

  async getWebhookVerifyToken(): Promise<string> {
    await this.ensureConfig()
    return this.webhookVerifyToken
  }

  async getAppSecret(): Promise<string> {
    await this.ensureConfig()
    return this.appSecret
  }

  /**
   * Resolved sender for this instance — useful for introspection (admin UI,
   * tests). Loads from SocialPlatform/env if not loaded yet.
   */
  async getResolvedSender(): Promise<Pick<WhatsAppSender, "phoneNumberId" | "accessToken" | "appSecret" | "webhookVerifyToken">> {
    await this.ensureConfig()
    return {
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      appSecret: this.appSecret,
      webhookVerifyToken: this.webhookVerifyToken,
    }
  }

  /**
   * Return a new WhatsAppService bound to a specific sender (phone number +
   * credentials). Use this for multi-number sends. The scoped instance skips
   * DB lookup entirely and uses the provided credentials.
   *
   * Example:
   *   const wa = provider.getWhatsApp(req.scope).withSender({
   *     platformId, phoneNumberId, accessToken,
   *   })
   *   await wa.sendTextMessage(to, text)
   */
  withSender(sender: WhatsAppSender): WhatsAppService {
    const scoped = new WhatsAppService()
    scoped.phoneNumberId = sender.phoneNumberId
    scoped.accessToken = sender.accessToken
    scoped.appSecret = sender.appSecret ?? this.appSecret
    scoped.webhookVerifyToken = sender.webhookVerifyToken ?? this.webhookVerifyToken
    // Explicit sender bypasses DB lookup — credentials are already resolved.
    scoped.platformLoaded_ = true
    scoped.appContainer_ = this.appContainer_
    scoped.senderPlatformId_ = sender.platformId ?? null
    return scoped
  }

  /**
   * Returns the SocialPlatform id this instance is bound to, or null when
   * the instance is the default/env-var-backed one.
   */
  getSenderPlatformId(): string | null {
    return this.senderPlatformId_
  }

  /**
   * Send a text message to a WhatsApp number
   * @param replyToWaMessageId - WhatsApp message ID to reply to (shows quoted message)
   */
  async sendTextMessage(to: string, text: string, replyToWaMessageId?: string): Promise<WhatsAppMessageResponse> {
    const payload: any = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }
    if (replyToWaMessageId) {
      payload.context = { message_id: replyToWaMessageId }
    }
    return this.sendRequest(payload)
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
   * Send an image message via URL
   */
  async sendImageMessage(
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<WhatsAppMessageResponse> {
    return this.sendRequest({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    })
  }

  /**
   * Send a document message via URL
   */
  async sendDocumentMessage(
    to: string,
    documentUrl: string,
    caption?: string,
    filename?: string
  ): Promise<WhatsAppMessageResponse> {
    return this.sendRequest({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link: documentUrl,
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
      },
    })
  }

  /**
   * Send a video message via URL
   */
  async sendVideoMessage(
    to: string,
    videoUrl: string,
    caption?: string
  ): Promise<WhatsAppMessageResponse> {
    return this.sendRequest({
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: { link: videoUrl, ...(caption ? { caption } : {}) },
    })
  }

  /**
   * Send media based on MIME type — auto-detects image/document/video
   */
  async sendMediaMessage(
    to: string,
    mediaUrl: string,
    mimeType?: string,
    caption?: string,
    filename?: string
  ): Promise<WhatsAppMessageResponse> {
    const mime = (mimeType || "").toLowerCase()
    if (mime.startsWith("image/")) {
      return this.sendImageMessage(to, mediaUrl, caption)
    }
    if (mime.startsWith("video/")) {
      return this.sendVideoMessage(to, mediaUrl, caption)
    }
    // Default to document for PDFs, spreadsheets, and everything else
    return this.sendDocumentMessage(to, mediaUrl, caption, filename)
  }

  /**
   * Retrieve media URL from Meta's Graph API.
   * WhatsApp webhooks provide a mediaId — this fetches the actual download URL.
   * The URL is temporary (valid ~5 min) so download promptly.
   */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mime_type?: string; file_size?: number } | null> {
    await this.ensureConfig()

    if (!this.accessToken) return null

    try {
      const resp = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })

      if (!resp.ok) return null

      const data = await resp.json() as { url?: string; mime_type?: string; file_size?: number }
      if (!data?.url) return null
      return { url: data.url, mime_type: data.mime_type, file_size: data.file_size }
    } catch {
      return null
    }
  }

  /**
   * Download media binary from Meta's temporary URL and return as Buffer.
   */
  async downloadMedia(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.ensureConfig()

    try {
      const resp = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })

      if (!resp.ok) return null

      const contentType = resp.headers.get("content-type") || "application/octet-stream"
      const arrayBuffer = await resp.arrayBuffer()
      return { buffer: Buffer.from(arrayBuffer), contentType }
    } catch {
      return null
    }
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
    await this.ensureConfig()

    if (!this.phoneNumberId || !this.accessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "WhatsApp: phone_number_id and access_token are required. Configure via SocialPlatform or env vars."
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
