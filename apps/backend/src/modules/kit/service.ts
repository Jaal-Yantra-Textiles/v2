import { MedusaService } from "@medusajs/framework/utils"
import KitBroadcast from "./models/kit-broadcast"

const KIT_API_BASE = "https://api.kit.com/v4"

export type KitBroadcastInput = {
  subject: string
  html: string
  /** Kit tag id to scope the broadcast to. Defaults to KIT_BLOG_TAG_ID. */
  tagId?: string
  /** ISO timestamp; Kit sends at this time. Omit/now → send immediately. */
  sendAt?: string
}

export type KitBroadcastResult = {
  id: string
  raw: any
}

export type KitSubscriberInput = {
  email: string
  first_name?: string
}

/**
 * Thin client for the Kit (kit.com, formerly ConvertKit) v4 API plus a tiny
 * audit store (`kit_broadcast`).
 *
 * Kit is a list/broadcast platform, NOT a per-recipient transactional API: you
 * upsert subscribers, tag them, then create ONE broadcast targeting the tag and
 * Kit fans it out (unlimited sends, no daily cap). This service exposes exactly
 * the calls the blog-broadcast path needs.
 *
 * Auth is `X-Kit-Api-Key` (API-key mode, 120 req/60s). Reads `KIT_API_KEY` and
 * `KIT_BLOG_TAG_ID` from the environment to stay consistent with the other
 * email modules (email-provider-manager reads its config the same way).
 */
class KitService extends MedusaService({ KitBroadcast }) {
  private get apiKey(): string {
    const key = process.env.KIT_API_KEY
    if (!key) {
      throw new Error("KIT_API_KEY is not set — cannot call the Kit API")
    }
    return key
  }

  private get blogTagId(): string | undefined {
    return process.env.KIT_BLOG_TAG_ID
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, any>
  ): Promise<any> {
    const res = await fetch(`${KIT_API_BASE}${path}`, {
      method,
      headers: {
        "X-Kit-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let parsed: any = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      const detail =
        parsed && typeof parsed === "object"
          ? JSON.stringify(parsed)
          : String(parsed ?? "")
      throw new Error(`Kit API ${method} ${path} failed (${res.status}): ${detail}`)
    }

    return parsed
  }

  /** Upsert a subscriber by email (idempotent on Kit's side). */
  async upsertSubscriber(input: KitSubscriberInput): Promise<any> {
    return this.request("POST", "/subscribers", {
      email_address: input.email,
      first_name: input.first_name || undefined,
      state: "active",
    })
  }

  /** Tag a subscriber (by email) so a broadcast filtered on the tag reaches them. */
  async tagSubscriber(email: string, tagId?: string): Promise<any> {
    const tag = tagId || this.blogTagId
    if (!tag) {
      throw new Error("No Kit tag id (pass tagId or set KIT_BLOG_TAG_ID)")
    }
    return this.request("POST", `/tags/${tag}/subscribers`, {
      email_address: email,
    })
  }

  /** Remove a subscriber from the tag (used to drop a now-suppressed address). */
  async untagSubscriber(subscriberId: string, tagId?: string): Promise<any> {
    const tag = tagId || this.blogTagId
    if (!tag) {
      throw new Error("No Kit tag id (pass tagId or set KIT_BLOG_TAG_ID)")
    }
    return this.request("DELETE", `/tags/${tag}/subscribers/${subscriberId}`)
  }

  /**
   * Create a broadcast scoped to a tag. `send_at` drives delivery — set to
   * (near-)now for an immediate send; Kit has no separate "send" action.
   */
  async createBroadcast(input: KitBroadcastInput): Promise<KitBroadcastResult> {
    const tag = input.tagId || this.blogTagId
    if (!tag) {
      throw new Error("No Kit tag id (pass tagId or set KIT_BLOG_TAG_ID)")
    }
    const raw = await this.request("POST", "/broadcasts", {
      subject: input.subject,
      content: input.html,
      public: false,
      send_at: input.sendAt || new Date().toISOString(),
      subscriber_filter: [
        { all: [{ type: "tag", ids: [Number(tag)] }] },
      ],
    })
    const id = String(raw?.broadcast?.id ?? raw?.id ?? "")
    return { id, raw }
  }

  /** Poll aggregate stats for a broadcast (recipients/opens/clicks). */
  async getBroadcastStats(broadcastId: string): Promise<any> {
    return this.request("GET", `/broadcasts/${broadcastId}/stats`)
  }

  /** Register a webhook rule for a single Kit event name. */
  async registerWebhook(targetUrl: string, eventName: string): Promise<any> {
    return this.request("POST", "/webhooks", {
      target_url: targetUrl,
      event: { name: eventName },
    })
  }
}

export default KitService
