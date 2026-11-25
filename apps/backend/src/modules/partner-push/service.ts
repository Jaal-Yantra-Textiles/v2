import { MedusaService } from "@medusajs/framework/utils"
import PartnerPushToken from "./models/partner-push-token"

export type PushPlatform = "ios" | "android"

export type PartnerPushTokenDTO = {
  id: string
  partner_id: string
  token: string
  platform: PushPlatform
  app_version: string | null
  created_at: Date | string
  updated_at: Date | string
}

/**
 * The partner device-token store — the APNs (iOS) / FCM (Android) tokens the
 * `notification-push` Module Provider sends to.
 *
 * Deliberately a plain module, not a notification provider: tokens are
 * infrastructure the provider *reads*, and registration happens through
 * `POST /partners/device-tokens` in the app layer. The provider resolves
 * this service through the `dependencies: ["partnerPush"]` declaration on
 * the notification module registration — the same #1339 pattern that puts
 * `email_suppression` inside the email providers' cradle.
 */
class PartnerPushService extends MedusaService({
  PartnerPushToken,
}) {
  /**
   * Upsert (partner, token) — a re-registering app (token rotation,
   * reinstall, re-login) must never leave duplicate rows.
   *
   * A device token belongs to ONE partner: whoever is signed in on that phone
   * now. Rows for the same token under any OTHER partner are dropped here.
   * Without this, a phone that signed into partner A and then partner B kept
   * receiving A's pushes, because the app only unregisters on a deliberate
   * logout — a session that ends on a 401 never does, and the logout call
   * races the token being cleared (founder's Android, 2026-11-25: Sharlho's
   * job alerts arrived on another account).
   */
  async registerToken(input: {
    partner_id: string
    token: string
    platform: PushPlatform
    app_version?: string | null
  }): Promise<PartnerPushTokenDTO> {
    const sameDevice = await this.listPartnerPushTokens({ token: input.token })
    const otherPartners = sameDevice.filter(
      (row) => row.partner_id !== input.partner_id
    )
    if (otherPartners.length > 0) {
      await this.deletePartnerPushTokens(otherPartners.map((row) => row.id))
    }

    const existing = sameDevice.filter(
      (row) => row.partner_id === input.partner_id
    )

    if (existing.length > 0) {
      const row = await this.updatePartnerPushTokens({
        id: existing[0].id,
        platform: input.platform,
        app_version: input.app_version ?? null,
      })
      return row as PartnerPushTokenDTO
    }

    const row = await this.createPartnerPushTokens({
      partner_id: input.partner_id,
      token: input.token,
      platform: input.platform,
      app_version: input.app_version ?? null,
    })
    return row as PartnerPushTokenDTO
  }

  async unregisterToken(partnerId: string, token: string): Promise<void> {
    await this.deletePartnerPushTokens({
      partner_id: partnerId,
      token,
    })
  }

  /** Every registered device of one partner — what a push fans out to. */
  async listTokensForPartner(partnerId: string): Promise<PartnerPushTokenDTO[]> {
    return (await this.listPartnerPushTokens({
      partner_id: partnerId,
    })) as PartnerPushTokenDTO[]
  }

  /** Drop a token the platform reported unregistered (410/404). */
  async pruneToken(tokenId: string): Promise<void> {
    await this.deletePartnerPushTokens({ id: tokenId }).catch(() => {})
  }
}

export { PartnerPushService }
export default PartnerPushService
