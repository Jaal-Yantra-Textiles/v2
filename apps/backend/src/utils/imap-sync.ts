import { ImapFlow } from "imapflow"
import { simpleParser, ParsedMail } from "mailparser"

export interface ParsedEmail {
  uid: number
  messageId: string | null
  from: string
  to: string[]
  subject: string
  htmlBody: string
  textBody: string | null
  receivedAt: Date
  folder: string
}

export interface ImapSyncConfig {
  host: string
  port: number
  user: string
  password: string
  tls: boolean
  mailbox: string
}

function getConfig(): ImapSyncConfig | null {
  const host = process.env.IMAP_HOST
  const user = process.env.IMAP_USER
  const password = process.env.IMAP_PASSWORD

  if (!host || !user || !password) {
    return null
  }

  return {
    host,
    port: parseInt(process.env.IMAP_PORT || "993", 10),
    user,
    password,
    tls: process.env.IMAP_TLS !== "false",
    mailbox: process.env.IMAP_MAILBOX || "INBOX",
  }
}

export class ImapSyncService {
  private client: ImapFlow | null = null
  private config: ImapSyncConfig | null = null
  private onNewEmail: ((email: ParsedEmail) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(onNewEmail?: (email: ParsedEmail) => void) {
    this.config = getConfig()
    this.onNewEmail = onNewEmail ?? null
  }

  /**
   * Configure from a SocialPlatform api_config object instead of env vars.
   * Call this before connect() to override env-based config.
   */
  configureFromPlatform(apiConfig: Record<string, any>): void {
    this.config = {
      host: apiConfig.host,
      port: apiConfig.port || 993,
      user: apiConfig.user || apiConfig.username,
      password: apiConfig.password,
      tls: apiConfig.tls !== false,
      mailbox: apiConfig.mailbox || "INBOX",
    }
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  async connect(): Promise<void> {
    if (!this.config) {
      throw new Error("IMAP not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD env vars.")
    }

    this.stopped = false

    this.client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    })

    this.client.on("error", (err: Error) => {
      console.error("[IMAP] Connection error:", err.message)
      this.scheduleReconnect()
    })

    this.client.on("close", () => {
      if (!this.stopped) {
        console.warn("[IMAP] Connection closed, scheduling reconnect")
        this.scheduleReconnect()
      }
    })

    await this.client.connect()
    console.log("[IMAP] Connected to", this.config.host)
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.client) {
      await this.client.logout().catch(() => {})
      this.client = null
    }
  }

  async syncRecent(count: number = 50): Promise<ParsedEmail[]> {
    if (!this.client || !this.config) {
      throw new Error("IMAP client not connected")
    }

    const mailbox = this.config.mailbox
    const lock = await this.client.getMailboxLock(mailbox)
    const emails: ParsedEmail[] = []

    try {
      const mailboxObj = this.client.mailbox
      const totalMessages = mailboxObj !== false ? mailboxObj.exists : 0
      if (totalMessages === 0) return emails

      const startSeq = Math.max(1, totalMessages - count + 1)
      const range = `${startSeq}:*`

      for await (const message of this.client.fetch(range, {
        source: true,
        uid: true,
      })) {
        if (!message.source) continue
        try {
          const parsed = await simpleParser(message.source)
          emails.push(this.toParsedEmail(message.uid, parsed, mailbox))
        } catch (parseErr: any) {
          console.error("[IMAP] Failed to parse message UID", message.uid, parseErr.message)
        }
      }
    } finally {
      lock.release()
    }

    return emails
  }

  async startIdle(): Promise<void> {
    if (!this.client || !this.config) return

    const mailbox = this.config.mailbox

    try {
      const lock = await this.client.getMailboxLock(mailbox)

      try {
        this.client.on("exists", async (data: { count: number; prevCount: number }) => {
          const newCount = data.count - data.prevCount
          if (newCount <= 0) return

          const startSeq = data.prevCount + 1
          const range = `${startSeq}:*`

          try {
            for await (const message of this.client!.fetch(range, {
              source: true,
              uid: true,
            })) {
              if (!message.source) continue
              const parsed = await simpleParser(message.source)
              const email = this.toParsedEmail(message.uid, parsed, mailbox)
              this.onNewEmail?.(email)
            }
          } catch (fetchErr: any) {
            console.error("[IMAP] Error fetching new messages:", fetchErr.message)
          }
        })
      } finally {
        lock.release()
      }
    } catch (err: any) {
      console.error("[IMAP] Error starting idle:", err.message)
    }
  }

  private toParsedEmail(uid: number, parsed: ParsedMail, folder: string): ParsedEmail {
    const fromAddr = parsed.from?.value?.[0]?.address || "unknown"
    const toAddrs = (parsed.to
      ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
          .flatMap((t) => t.value.map((v) => v.address || ""))
          .filter(Boolean)
      : []) as string[]

    return {
      uid,
      messageId: parsed.messageId || null,
      from: fromAddr,
      to: toAddrs,
      subject: parsed.subject || "(no subject)",
      htmlBody: parsed.html || parsed.textAsHtml || "",
      textBody: parsed.text || null,
      receivedAt: parsed.date || new Date(),
      folder,
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        console.log("[IMAP] Attempting reconnect...")
        await this.connect()
        await this.startIdle()
      } catch (err: any) {
        console.error("[IMAP] Reconnect failed:", err.message)
        this.scheduleReconnect()
      }
    }, 30_000)
  }
}

let instance: ImapSyncService | null = null

export function getImapSyncService(
  onNewEmail?: (email: ParsedEmail) => void
): ImapSyncService {
  if (!instance) {
    instance = new ImapSyncService(onNewEmail)
  }
  return instance
}

/**
 * Create a fresh (non-singleton) ImapSyncService pre-configured with the
 * given api_config from a SocialPlatform record.
 */
export function createImapSyncService(
  apiConfig: Record<string, any>,
  onNewEmail?: (email: ParsedEmail) => void
): ImapSyncService {
  const service = new ImapSyncService(onNewEmail)
  service.configureFromPlatform(apiConfig)
  return service
}
