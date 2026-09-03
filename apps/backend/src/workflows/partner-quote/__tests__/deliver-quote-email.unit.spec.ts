import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../../lib/bot-recipients"
import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { deliverQuoteEmail } from "../deliver-quote-email"

/**
 * #1486 slice 1 — the partner introduction, sent in code before the quote.
 *
 * The audit's finding, restated as the property under test: the template
 * existed, the mint event was emitted, the subscriber allowlisted it — and
 * nothing in code ever sent the introduction. Whether a buyer was introduced
 * at all was decided by a visual flow that may not exist in any given
 * environment.
 *
 * These tests pin what slice 1 promises: the introduction goes FIRST and is
 * awaited, a failed introduction never costs the buyer their quote, and the
 * failure is logged loudly enough for a human to act on. The link resolution
 * and the email payload builder run for real — they have their own specs
 * (`quote-link.unit.spec.ts`, `quote-email.unit.spec.ts`) — but the two send
 * workflows are mocked: this file is about sequencing and failure, not about
 * Resend.
 */

const mockQuoteRun = jest.fn()
const mockIntroductionRun = jest.fn()
const mockResolveBuyerLink = jest.fn()

jest.mock("../../email/workflows/send-quote-email", () => ({
  sendQuoteEmailWorkflow: () => ({ run: mockQuoteRun }),
}))

jest.mock("../../email/workflows/send-quote-introduction-email", () => ({
  sendQuoteIntroductionEmailWorkflow: () => ({ run: mockIntroductionRun }),
}))

jest.mock("../../../modules/partner-quote/lib/quote-link", () => ({
  resolveQuoteBuyerLink: (...args: any[]) => mockResolveBuyerLink(...args),
}))

// The module index pulls in the whole service graph; only the key is needed.
jest.mock("../../../modules/partner-quote", () => ({
  PARTNER_QUOTE_MODULE: "partnerQuote",
}))

const BUYER_URL = "https://shop.marcha.test/de/quotes/raw_token_1"

const QUOTE = {
  id: "quote_1",
  partner_id: "partner_1",
  email_sent_to: "buyer@example.com",
  recipient_name: "Meera",
  recipient_company: "Meera Textiles",
  quoted_landed_total: 360000,
  currency_code: "inr",
  destination_city: "Berlin",
  destination_country_code: "de",
  expires_at: new Date("2026-10-01T00:00:00.000Z"),
}

const deliveryInput = () => ({
  quote: QUOTE,
  token: "raw_token_1",
  partnerName: "Marcha",
  lineCount: 6,
  totalQuantity: 10,
  actorType: "partner" as const,
  actorId: "partner_user_1",
})

const scopeWith = () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const eventBus = { emit: jest.fn(async () => undefined) }
  const quoteService = {
    updatePartnerQuotes: jest.fn(async () => undefined),
    recordEvent: jest.fn(async () => undefined),
  }
  const scope: any = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return log
      if (key === Modules.EVENT_BUS) return eventBus
      if (key === PARTNER_QUOTE_MODULE) return quoteService
      throw new Error(`unexpected resolve(${key})`)
    },
  }
  return { log, eventBus, quoteService, scope }
}

describe("deliverQuoteEmail — the partner introduction (#1486 slice 1)", () => {
  beforeEach(() => {
    mockQuoteRun.mockReset()
    mockIntroductionRun.mockReset()
    mockResolveBuyerLink.mockReset()
    mockResolveBuyerLink.mockResolvedValue(BUYER_URL)
    mockQuoteRun.mockResolvedValue({ result: { id: "noti_quote_1" } })
    mockIntroductionRun.mockResolvedValue({ result: { id: "noti_intro_1" } })
  })

  it("sends the introduction BEFORE the quote — awaited, not fired and forgotten", async () => {
    // A deferred this test controls. invocationCallOrder can only prove which
    // call STARTED first, and a fire-and-forget introduction also starts
    // first — so it cannot distinguish the two. A promise that stays pending
    // until this test resolves it can: while it hangs, nothing later may run.
    let resolveIntroduction!: (value: { result: { id: string } }) => void
    mockIntroductionRun.mockImplementationOnce(
      () =>
        new Promise<{ result: { id: string } }>((resolve) => {
          resolveIntroduction = resolve
        })
    )
    const { scope, log } = scopeWith()

    let settled = false
    const delivering = deliverQuoteEmail(scope, deliveryInput()).then((v) => {
      settled = true
      return v
    })

    // Drain everything that can run without the introduction resolving.
    // setImmediate is a macrotask, so every microtask queued before the
    // pending await has settled by the time this resumes. If the quote send
    // — or the return — happened here, the introduction was fired and
    // forgotten, and its "your quote follows shortly" copy is a lie.
    await new Promise<void>((ready) => setImmediate(ready))
    expect(mockIntroductionRun).toHaveBeenCalledTimes(1)
    expect(mockQuoteRun).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    resolveIntroduction({ result: { id: "noti_intro_1" } })
    const verdict = await delivering

    expect(mockQuoteRun).toHaveBeenCalledTimes(1)

    const introductionInput = mockIntroductionRun.mock.calls[0][0].input
    expect(introductionInput.email).toBe("buyer@example.com")
    expect(introductionInput.data).toEqual({
      partner_name: "Marcha",
      recipient_name: "Meera",
      recipient_company: "Meera Textiles",
      line_count: 6,
      total_quantity: 10,
      destination: "Berlin, Germany",
      current_year: new Date().getUTCFullYear(),
    })

    // The quote send is untouched by the new one: same buyer, same link.
    const quoteInput = mockQuoteRun.mock.calls[0][0].input
    expect(quoteInput.email).toBe("buyer@example.com")
    expect(quoteInput.data.quote_url).toBe(BUYER_URL)

    expect(verdict).toEqual({
      sent: true,
      to: "buyer@example.com",
      buyer_url: BUYER_URL,
      reason: null,
    })
    expect(log.error).not.toHaveBeenCalled()
  })

  it("🔴 still sends the quote when the introduction throws", async () => {
    mockIntroductionRun.mockRejectedValueOnce(
      new Error("Resend rejected the introduction")
    )
    const { scope } = scopeWith()

    const verdict = await deliverQuoteEmail(scope, deliveryInput())

    // The introduction was genuinely attempted. Without this, deleting the
    // introduction entirely leaves the rejection unconsumed, the quote still
    // sends, and every assertion below passes on the old code too.
    expect(mockIntroductionRun).toHaveBeenCalledTimes(1)

    // The quote email is the only durable copy of the token — a failed
    // introduction is a lost courtesy, not a reason to lose the link.
    expect(mockQuoteRun).toHaveBeenCalledTimes(1)
    expect(verdict.sent).toBe(true)
    expect(verdict.reason).toBeNull()
  })

  it("logs the failed introduction with the partner id, buyer email and error", async () => {
    mockIntroductionRun.mockRejectedValueOnce(
      new Error("Resend rejected the introduction")
    )
    const { scope, log } = scopeWith()

    await deliverQuoteEmail(scope, deliveryInput())

    // Exactly once, and exactly this: the three things a human needs to act.
    // The quote send succeeded, so no other error line exists to satisfy a
    // looser match.
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error).toHaveBeenCalledWith(
      "[quote] introduction NOT delivered quote=quote_1 partner_id=partner_1 to=buyer@example.com: Resend rejected the introduction"
    )
  })

  it("does not log a suppressed introduction as delivered", async () => {
    // #1333 — a send to a known crawler address is a silent no-op that
    // returns a synthetic id. "Delivered" would be a lie; the quote send
    // right after reports the crawler address loudly as ITS own failure.
    mockIntroductionRun.mockResolvedValueOnce({
      result: { id: BOT_SUPPRESSED_SEND_ID },
    })
    const { scope, log } = scopeWith()

    await deliverQuoteEmail(scope, deliveryInput())

    expect(log.warn).toHaveBeenCalledWith(
      "[quote] introduction suppressed (known crawler address) quote=quote_1 to=buyer@example.com"
    )
    expect(log.info).not.toHaveBeenCalledWith(
      expect.stringContaining("introduction delivered")
    )
    expect(mockQuoteRun).toHaveBeenCalledTimes(1)
  })

  it("does not introduce when no quote email can follow", async () => {
    // The introduction promises "your quote follows shortly". When the
    // delivery path already knows the quote cannot be sent — no buyer link —
    // that promise is a lie the system is aware of, so nothing goes out.
    mockResolveBuyerLink.mockResolvedValue(null)
    const { scope } = scopeWith()

    const verdict = await deliverQuoteEmail(scope, deliveryInput())

    expect(mockIntroductionRun).not.toHaveBeenCalled()
    expect(mockQuoteRun).not.toHaveBeenCalled()
    expect(verdict.sent).toBe(false)
  })

  it("does not introduce a buyer with no email address", async () => {
    const { scope } = scopeWith()

    await deliverQuoteEmail(scope, {
      ...deliveryInput(),
      quote: { ...QUOTE, email_sent_to: null },
    })

    expect(mockIntroductionRun).not.toHaveBeenCalled()
    expect(mockQuoteRun).not.toHaveBeenCalled()
  })
})
