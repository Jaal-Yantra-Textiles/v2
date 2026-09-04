/**
 * #1339 — the suppression ledger must be consulted at EVERY provider, and the
 * upstream API must genuinely not be called.
 *
 * Sibling of `bot-recipient-guard.unit.spec.ts`, and the same lesson behind it:
 * a guard on one path is not a guard. Asserting the return value alone would be
 * worthless here — a send that was suppressed and a send that succeeded look
 * identical from the outside, so every case asserts the upstream mock.
 */
import { EMAIL_SUPPRESSED_SEND_ID } from "../../lib/email-suppression-policy"

const SUPPRESSED = "dead.mailbox@example.com"
const CLEAN = "real.customer@example.com"

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
})

/** A suppression-service double that returns rows only for the suppressed address. */
const makeSuppressionService = (reason: string) => ({
  listEmailSuppressions: jest.fn(async (filters: Record<string, unknown>) => {
    const email = String((filters ?? {}).email ?? "")
    return email === SUPPRESSED ? [{ reason }] : []
  }),
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

describe("suppression ledger is enforced at every provider (#1339)", () => {
  beforeEach(() => jest.clearAllMocks())

  describe("resend — channel email (transactional/lifecycle)", () => {
    const load = () => require("../resend/service").default

    it("does not call Resend for a hard-bounced address", async () => {
      const svc = new (load())(
        { logger: makeLogger(), email_suppression: makeSuppressionService("hard_bounce") },
        { api_key: "re_test", from: "a@b.com", channels: ["email"] }
      )

      const res = await svc.send({ to: SUPPRESSED, template: "order-shipment-delivered", data: {} })

      expect(resendSend).not.toHaveBeenCalled()
      expect(res.id).toBe(EMAIL_SUPPRESSED_SEND_ID)
    })

    it("still sends to an address with nothing on file", async () => {
      const svc = new (load())(
        { logger: makeLogger(), email_suppression: makeSuppressionService("hard_bounce") },
        { api_key: "re_test", from: "a@b.com", channels: ["email"] }
      )

      await svc.send({ to: CLEAN, template: "order-shipment-delivered", data: {} })

      expect(resendSend).toHaveBeenCalledTimes(1)
    })

    it("still sends to someone who only unsubscribed — they paid for the order", async () => {
      const svc = new (load())(
        { logger: makeLogger(), email_suppression: makeSuppressionService("unsubscribe") },
        { api_key: "re_test", from: "a@b.com", channels: ["email"] }
      )

      await svc.send({ to: SUPPRESSED, template: "order-shipment-delivered", data: {} })

      expect(resendSend).toHaveBeenCalledTimes(1)
    })

    it("sends when the ledger is unreachable, rather than dropping real mail", async () => {
      const logger = makeLogger()
      const svc = new (load())(
        { logger, email_suppression: undefined },
        { api_key: "re_test", from: "a@b.com", channels: ["email"] }
      )

      await svc.send({ to: SUPPRESSED, template: "order-shipment-delivered", data: {} })

      expect(resendSend).toHaveBeenCalledTimes(1)
      const errors = logger.error.mock.calls.map((c: any[]) => String(c[0]))
      expect(errors.some((l) => l.includes("[email-suppression-unavailable]"))).toBe(true)
    })
  })

  describe("mailjet — channel email_bulk (marketing)", () => {
    const load = () => require("../mailjet/service").default

    it("does not call Mailjet for an unsubscribed address", async () => {
      const svc = new (load())(
        { logger: makeLogger(), email_suppression: makeSuppressionService("unsubscribe") },
        {
          api_key: "k",
          secret_key: "s",
          from_email: "a@b.com",
          channels: ["email_bulk"],
        }
      )

      const res = await svc.send({ to: SUPPRESSED, template: "newsletter", data: {} })

      expect(mailjetRequest).not.toHaveBeenCalled()
      expect(res.id).toBe(EMAIL_SUPPRESSED_SEND_ID)
    })

    it("drops the suppressed address out of a bulk batch", async () => {
      const svc = new (load())(
        { logger: makeLogger(), email_suppression: makeSuppressionService("hard_bounce") },
        {
          api_key: "k",
          secret_key: "s",
          from_email: "a@b.com",
          channels: ["email_bulk"],
        }
      )

      await svc.sendBulk([
        { to: CLEAN, subject: "hi", html: "<p>hi</p>" },
        { to: SUPPRESSED, subject: "hi", html: "<p>hi</p>" },
      ])

      // Mailjet batches into ONE request; the payload must carry only the
      // survivor. Asserting the call count alone would pass with both in it.
      const payloads = mailjetRequest.mock.calls.map((c: any[]) => JSON.stringify(c[0]))
      const joined = payloads.join(" ")
      expect(joined).toContain(CLEAN)
      expect(joined).not.toContain(SUPPRESSED)
    })
  })
})
