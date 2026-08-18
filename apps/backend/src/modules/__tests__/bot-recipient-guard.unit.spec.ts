/**
 * The guard has to hold at EVERY provider, not just the one we happened to
 * debug. #1319's lesson: a guard on one path is not a guard. So this exercises
 * each provider's real send() and asserts the upstream API is never touched.
 */
import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"

const BOT = "johnsmith004@storebotmail.joonix.net"
const HUMAN = "real.customer@gmail.com"

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
})

const resendSend = jest.fn().mockResolvedValue({ data: { id: "re_real" }, error: null })
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}))

const mailjetRequest = jest.fn().mockResolvedValue({ body: { Messages: [] } })
jest.mock("node-mailjet", () => ({
  __esModule: true,
  default: {
    apiConnect: jest.fn().mockImplementation(() => ({
      post: jest.fn().mockReturnValue({ request: mailjetRequest }),
    })),
  },
}))

describe("bot-recipient guard is enforced at every provider (#1333)", () => {
  beforeEach(() => jest.clearAllMocks())

  describe("resend (channel: email — the cart-abandoned path)", () => {
    const load = () => require("../resend/service").default

    it("suppresses the bot address without calling Resend", async () => {
      const svc = new (load())({ logger: makeLogger() }, { api_key: "re_test", from: "a@b.com" })
      const res = await svc.send({ to: BOT, template: "cart-abandoned", data: {} })

      expect(resendSend).not.toHaveBeenCalled()
      expect(res.id).toBe(BOT_SUPPRESSED_SEND_ID)
    })

    it("logs the suppression — it must never be silent", async () => {
      const logger = makeLogger()
      const svc = new (load())({ logger }, { api_key: "re_test", from: "a@b.com" })
      await svc.send({ to: BOT, template: "cart-abandoned", data: {} })

      const line = logger.warn.mock.calls.map((c: any[]) => String(c[0])).join("\n")
      expect(line).toContain("[bot-recipient-suppressed]")
      expect(line).toContain("cart-abandoned")
      expect(line).toContain("joonix.net")
    })

    it("still sends to a real customer", async () => {
      const svc = new (load())({ logger: makeLogger() }, { api_key: "re_test", from: "a@b.com" })
      const res = await svc.send({
        to: HUMAN,
        template: "cart-abandoned",
        data: { _template_processed: true, _template_html_content: "<p>hi</p>", _template_subject: "s" },
      })

      expect(resendSend).toHaveBeenCalledTimes(1)
      expect(res.id).not.toBe(BOT_SUPPRESSED_SEND_ID)
    })
  })

  describe("mailjet (channel: email_bulk)", () => {
    const load = () => require("../mailjet/service").default
    const opts = { api_key: "k", secret_key: "s", from_email: "a@b.com" }

    it("suppresses the bot address without calling Mailjet", async () => {
      const svc = new (load())({ logger: makeLogger() }, opts)
      const res = await svc.send({ to: BOT, template: "cart-abandoned", data: {} })

      expect(mailjetRequest).not.toHaveBeenCalled()
      expect(res.id).toBe(BOT_SUPPRESSED_SEND_ID)
    })

    it("drops bot addresses out of a BULK batch and keeps the humans", async () => {
      const svc = new (load())({ logger: makeLogger() }, opts)
      ;(svc as any).client = { post: jest.fn().mockReturnValue({ request: mailjetRequest }) }

      await svc.sendBulk([
        { to: HUMAN, subject: "s", htmlContent: "<p>1</p>" },
        { to: BOT, subject: "s", htmlContent: "<p>2</p>" },
        { to: "second.human@gmail.com", subject: "s", htmlContent: "<p>3</p>" },
      ])

      expect(mailjetRequest).toHaveBeenCalledTimes(1)
      const payload = mailjetRequest.mock.calls[0][0]
      const recipients = payload.Messages.map((m: any) => m.To[0].Email)
      expect(recipients).toEqual([HUMAN, "second.human@gmail.com"])
      expect(recipients).not.toContain(BOT)
    })

    /**
     * The caller contract: a suppressed address is in NEITHER `successful` nor
     * `failed`, so callers that walk only those two lists leave their queue row
     * untouched — pending forever, re-picked every run. `suppressed` is what
     * lets them retire the row. Pinned here because it is invisible from
     * inside the provider.
     */
    it("reports suppressed addresses so callers can retire the row", async () => {
      const svc = new (load())({ logger: makeLogger() }, opts)
      ;(svc as any).client = { post: jest.fn().mockReturnValue({ request: mailjetRequest }) }

      const res = await svc.sendBulk([
        { to: HUMAN, subject: "s", htmlContent: "<p>1</p>" },
        { to: BOT, subject: "s", htmlContent: "<p>2</p>" },
      ])

      expect(res.suppressed).toEqual([
        { email: BOT, rule: "joonix.net", note: expect.stringContaining("Google") },
      ])
      expect(res.successful.map((r: any) => r.email)).not.toContain(BOT)
      expect(res.failed.map((r: any) => r.email)).not.toContain(BOT)
    })

    it("an all-bot bulk batch makes no API call at all", async () => {
      const svc = new (load())({ logger: makeLogger() }, opts)
      ;(svc as any).client = { post: jest.fn().mockReturnValue({ request: mailjetRequest }) }

      const res = await svc.sendBulk([{ to: BOT, subject: "s", htmlContent: "<p>1</p>" }])

      expect(mailjetRequest).not.toHaveBeenCalled()
      expect(res.successful).toHaveLength(0)
    })
  })

  /**
   * Maileroo's SDK is ESM-only and cannot be instantiated under this jest
   * transform, so it gets a structural check instead of an exercised one. This
   * block is also the invariant that matters longest: it fails when someone
   * adds a fourth email provider — or a new bulk path — without the guard.
   */
  describe("every email provider wires the guard (structural invariant)", () => {
    const fs = require("fs")
    const path = require("path")
    const dir = path.join(__dirname, "..")

    const EMAIL_PROVIDERS = ["resend", "mailjet", "maileroo"]

    for (const provider of EMAIL_PROVIDERS) {
      it(`${provider}: send() consults classifyRecipient`, () => {
        const src = fs.readFileSync(path.join(dir, provider, "service.ts"), "utf8")
        expect(src).toContain("classifyRecipient")
        expect(src).toContain("BOT_SUPPRESSED_SEND_ID")
        expect(src).toContain("bot-recipients")
      })

      it(`${provider}: any sendBulk() consults partitionBotRecipients`, () => {
        const src = fs.readFileSync(path.join(dir, provider, "service.ts"), "utf8")
        if (!src.includes("async sendBulk(")) return // provider has no bulk path
        expect(src).toContain("partitionBotRecipients")
      })
    }

    /**
     * The direction that matters is EVERY-WIRED-PROVIDER ⊆ COVERED, not the
     * reverse. Asserting only that our three are present passes happily when a
     * fourth email provider is added with no guard — which is the exact failure
     * this block exists to catch. So parse the provider blocks out of the prod
     * config and assert every one bound to an `email*` channel is covered here.
     */
    const wiredEmailProviders = (): string[] => {
      const cfg = fs.readFileSync(
        path.join(__dirname, "..", "..", "..", "medusa-config.prod.ts"),
        "utf8"
      )
      // One entry per `resolve: "./src/modules/<x>"`, paired with the channels
      // block that follows it before the next `resolve:`.
      const blocks = cfg.split(/resolve:\s*/).slice(1)
      const found: string[] = []
      for (const block of blocks) {
        const mod = block.match(/^"\.\/src\/modules\/([a-z0-9_-]+)"/)
        if (!mod) continue
        const channels = block.match(/channels:\s*\[([^\]]*)\]/)
        if (!channels) continue
        const isEmail = channels[1]
          .split(",")
          .map((c: string) => c.trim().replace(/['"]/g, ""))
          .some((c: string) => c.startsWith("email"))
        if (isEmail) found.push(mod[1])
      }
      return found
    }

    it("finds the email providers actually wired in prod (parser sanity)", () => {
      // If this fails the parser has drifted from the config format, and the
      // coverage assertion below would pass vacuously.
      expect(wiredEmailProviders().sort()).toEqual([...EMAIL_PROVIDERS].sort())
    })

    it("every email provider wired in prod is covered by this spec", () => {
      for (const wired of wiredEmailProviders()) {
        expect(EMAIL_PROVIDERS).toContain(wired)
      }
    })
  })
})
