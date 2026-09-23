import { createSign, createPrivateKey, KeyObject } from "crypto"
import http2 from "http2"
import {
  AbstractNotificationProviderService,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"

import {
  PartnerPushService,
  PartnerPushTokenDTO,
} from "../partner-push/service"

type InjectedDependencies = {
  logger: Logger
  // Injected by the `dependencies: ["partnerPush"]` declaration on the
  // notification module registration — the #1339 pattern (see
  // src/lib/email-suppression-lookup.ts for the discovery notes).
  partnerPush: PartnerPushService
}

type PushProviderOptions = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// APNs — HTTP/2 API with token-based (ES256 p8) auth. Node's `crypto` signs
// ES256 and `http2` is built in, so there are no dependencies here.
//
// Env (all-or-nothing; unset ⇒ the iOS leg skips with a warn, mirroring the
// #1339 "fail open, loudly" rule for the email suppression guard):
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (p8 PEM), APNS_BUNDLE_ID,
//   APNS_ENV=sandbox switches api.sandbox.push.apple.com.
// ─────────────────────────────────────────────────────────────────────────────

function sendAPNs(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  logger: Logger
): Promise<boolean> {
  return new Promise((resolve) => {
    const keyId = process.env.APNS_KEY_ID
    const teamId = process.env.APNS_TEAM_ID
    const bundleId = process.env.APNS_BUNDLE_ID
    const privateKeyRaw = process.env.APNS_PRIVATE_KEY

    if (!keyId || !teamId || !bundleId || !privateKeyRaw) {
      logger.warn(
        "[partner-push] APNs not configured (need APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID) — skipping iOS push"
      )
      return resolve(false)
    }

    // Provider JWT: header {alg, kid}, claims {iss: team, iat} — good ~1h.
    let key: KeyObject
    try {
      key = createPrivateKey({
        key: privateKeyRaw.replace(/\\n/g, "\n"),
        format: "pem",
      })
    } catch (e: any) {
      logger.error(`[partner-push] APNS_PRIVATE_KEY is not a parseable PEM: ${e?.message}`)
      return resolve(false)
    }

    const header = { alg: "ES256" as const, kid: keyId }
    const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) }
    const jwtInput = [
      Buffer.from(JSON.stringify(header)).toString("base64url"),
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
    ].join(".")

    let signature: Buffer
    try {
      const signer = createSign("SHA256")
      signer.update(jwtInput)
      // createSign emits the DER signature, which is the correct JWS form.
      signature = signer.sign(key)
    } catch (e: any) {
      logger.error(`[partner-push] failed to sign APNs JWT: ${e?.message}`)
      return resolve(false)
    }

    const providerToken = `${jwtInput}.${signature.toString("base64url")}`

    const host =
      process.env.APNS_ENV === "sandbox"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com"

    const payload = JSON.stringify({
      aps: {
        alert: { title, body },
        sound: "default",
      },
      // Deep-link hints: production_run_id / url / resource_type …
      data,
    })

    const session = http2.connect(`https://${host}`)
    session.on("error", (e) => {
      logger.error(`[partner-push] APNs session error: ${e.message}`)
      resolve(false)
    })

    const stream = session.request({
      ":method": "POST",
      ":path": `/3/device/${encodeURIComponent(token)}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    })

    stream.setTimeout(10_000, () => {
      stream.close(http2.constants.NGHTTP2_CANCEL)
      resolve(false)
    })

    stream.on("response", (headers) => {
      const status = headers[":status"] as number
      resolve(status >= 200 && status < 300)
      stream.close()
    })
    stream.on("error", (e) => {
      logger.error(`[partner-push] APNs stream error: ${e.message}`)
      resolve(false)
    })
    stream.end(payload)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// FCM — HTTP v1 with a service-account access token minted the standard way
// (RS256 JWT → oauth2.googleapis.com/token). Node's crypto covers the signing;
// `fetch` (Node 20) covers the calls.
//
// Env (all-or-nothing; unset ⇒ the Android leg skips with a warn):
//   FCM_SERVICE_ACCOUNT_JSON — the full service-account key file contents,
//   carrying client_email, private_key and project_id.
// ─────────────────────────────────────────────────────────────────────────────

async function sendFCM(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  logger: Logger
): Promise<boolean> {
  const rawAccount = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!rawAccount) {
    logger.warn(
      "[partner-push] FCM not configured (need FCM_SERVICE_ACCOUNT_JSON) — skipping Android push"
    )
    return false
  }

  let account: {
    client_email?: string
    private_key?: string
    project_id?: string
  }
  try {
    account = JSON.parse(rawAccount)
  } catch (e: any) {
    logger.error(`[partner-push] FCM_SERVICE_ACCOUNT_JSON is not valid JSON: ${e?.message}`)
    return false
  }
  const { client_email, private_key, project_id } = account
  if (!client_email || !private_key || !project_id) {
    logger.error(
      "[partner-push] FCM_SERVICE_ACCOUNT_JSON must carry client_email, private_key and project_id"
    )
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  const jwtInput = [
    Buffer.from(JSON.stringify({ alg: "RS256" as const, typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(
      JSON.stringify({
        iss: client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url"),
  ].join(".")

  const signer = createSign("RSA-SHA256")
  signer.update(jwtInput)
  const assertion = `${jwtInput}.${signer
    .sign(private_key.replace(/\\n/g, "\n"))
    .toString("base64url")}`

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!tokenRes.ok) {
    logger.error(
      `[partner-push] FCM token exchange failed: ${tokenRes.status} ${await tokenRes
        .text()
        .catch(() => "")}`
    )
    return false
  }
  const accessToken = ((await tokenRes.json()) as { access_token?: string })
    .access_token
  if (!accessToken) {
    return false
  }

  const message = {
    message: {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
      ),
    },
  }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // 404/410 UNREGISTERED — the caller prunes the token on this answer.
    if (res.status === 404 || res.status === 410 || /UNREGISTERED/i.test(text)) {
      return false
    }
    logger.error(`[partner-push] FCM send failed: ${res.status} ${text}`)
    return false
  }
  return true
}

/**
 * Notification Module Provider for the `push` channel — the APNs/FCM leg of
 * the partner notification system.
 *
 * Callers ride the existing partner notification flow: every
 * `createPartnerNotification(...)` (channel=feed) also creates a `push` twin
 * row, and the notification module routes it here by channel. The row
 * persists as the push audit — same philosophy as `whatsapp-audit`, except
 * this provider does the real network send.
 *
 * `notification.to` carries the partner id (the routing key the partner bell
 * uses). The provider resolves the device tokens for that partner from the
 * `partnerPush` module and fans out: APNs for ios rows, FCM for android.
 * Failures never throw — a push is observability, not causality, so a
 * misconfigured APNs/FCM env must never bubble into the producing workflow.
 */
class PartnerPushNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "partner-push"

  protected readonly logger: Logger
  protected readonly tokenStore: PartnerPushService

  constructor(
    { logger, partnerPush }: InjectedDependencies,
    _options: PushProviderOptions = {}
  ) {
    super()
    this.logger = logger
    this.tokenStore = partnerPush
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const partnerId = notification.to
    const data = (notification.data ?? {}) as Record<string, unknown>
    const title = String(data.title ?? notification.content?.subject ?? "")
    const body = String(data.description ?? notification.content?.text ?? "")
    const deepLink = (data.data ?? data) as Record<string, unknown>

    if (!partnerId) {
      this.logger.warn(
        "[partner-push] send() called without `to` (partner id) — nothing to route"
      )
      return { id: `push-noop-${Date.now()}` }
    }

    let tokens: PartnerPushTokenDTO[] = []
    try {
      tokens = await this.tokenStore.listTokensForPartner(partnerId)
    } catch (e: any) {
      // Fail open and loudly (#1339 rule): never block the producing
      // workflow on the push leg.
      this.logger.error(
        `[partner-push] token lookup failed for partner=${partnerId}: ${e?.message}`
      )
      return { id: `push-error-${Date.now()}` }
    }

    if (tokens.length === 0) {
      // Partner has no registered device — quiet, this is the common case.
      return { id: `push-none-${Date.now()}` }
    }

    let delivered = 0
    const sentTo: string[] = []
    for (const row of tokens) {
      const ok =
        row.platform === "ios"
          ? await sendAPNs(row.token, title, body, deepLink, this.logger)
          : await sendFCM(row.token, title, body, deepLink, this.logger)
      if (ok) {
        delivered += 1
        sentTo.push(row.platform)
      } else if (row.platform === "android") {
        // FCM false ⇒ UNREGISTERED-class answer; the install is gone.
        // APNs false can also be a timeout, so the iOS prune stays
        // best-effort — a wrongly-pruned token simply re-registers on the
        // app's next launch.
        await this.tokenStore.pruneToken(row.id)
      }
    }

    this.logger.info(
      `[partner-push] partner=${partnerId} delivered=${delivered}/${tokens.length} (${sentTo.join(",") || "none"})`
    )

    return {
      // The external id stamps the notification row: how many devices it
      // reached, so a push row is self-auditing in the feed query.
      id: `push-${delivered}-${tokens.length}-${Date.now()}`,
    }
  }
}

export default PartnerPushNotificationProviderService
