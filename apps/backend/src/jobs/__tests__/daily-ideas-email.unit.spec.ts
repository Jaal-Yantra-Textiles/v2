import {
  isSendEnabled,
  runDailyIdeasEmail,
  type GenerateRunner,
  type SendRunner,
} from "../daily-ideas-email"

/**
 * #659 slice 2, PR-4 — unit tests for the daily-ideas-email orchestrator.
 *
 * Uses INJECTED stubs for the generate/send runners, so CI NEVER calls a live
 * LLM or sends a real email. Asserts the chain wiring + operator-safety gate +
 * fail-soft (never throws) discipline.
 */

// Minimal fake container — only `resolve(LOGGER)` is used; return a noop logger.
const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} }
const fakeContainer = { resolve: () => fakeLogger } as any

const genResult = (patch: Record<string, any> = {}) => ({
  skipped: false,
  generated: true,
  guard_passed: true,
  regenerated: false,
  log_id: "log_1",
  output_text: "ideas",
  model_used: "test",
  ground_truth: null,
  ...patch,
})

const sendResult = (patch: Record<string, any> = {}) => ({
  sent: 2,
  skipped: false,
  guard_passed: true,
  review_notice_sent: false,
  recipients: 2,
  ...patch,
})

describe("isSendEnabled", () => {
  it("is true only for explicit truthy opt-in values", () => {
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "true" } as any)).toBe(true)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "1" } as any)).toBe(true)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "ON" } as any)).toBe(true)
  })
  it("defaults OFF (missing / falsey)", () => {
    expect(isSendEnabled({} as any)).toBe(false)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "false" } as any)).toBe(false)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "" } as any)).toBe(false)
  })
})

describe("runDailyIdeasEmail", () => {
  it("(a) guard-passed log → send runner invoked with that logId", async () => {
    let sentWith: any = null
    const generate: GenerateRunner = async () => genResult({ log_id: "log_42" })
    const send: SendRunner = async (input) => {
      sentWith = input
      return sendResult()
    }

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send,
      sendEnabled: true,
    })

    expect(sentWith).toEqual({ logId: "log_42" })
    expect(summary.send_attempted).toBe(true)
    expect(summary.sent).toBe(2)
    expect(summary.errored).toBe(false)
  })

  it("(b) guard-FAILED result → send runner NOT invoked", async () => {
    const send = jest.fn<Promise<any>, [any]>()
    const generate: GenerateRunner = async () =>
      genResult({ guard_passed: false, reason: "guard_failed" })

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send: send as any,
      sendEnabled: true,
    })

    expect(send).not.toHaveBeenCalled()
    expect(summary.send_attempted).toBe(false)
    expect(summary.skipped_reason).toBe("guard_failed")
  })

  it("(b2) skipped generate (no snapshots) → send NOT invoked", async () => {
    const send = jest.fn<Promise<any>, [any]>()
    const generate: GenerateRunner = async () =>
      genResult({ generated: false, guard_passed: false, skipped: true, log_id: null, reason: "no_snapshots" })

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send: send as any,
      sendEnabled: true,
    })

    expect(send).not.toHaveBeenCalled()
    expect(summary.send_attempted).toBe(false)
    expect(summary.skipped_reason).toBe("no_snapshots")
  })

  it("(c) send disabled by flag → generate ran, send skipped", async () => {
    const send = jest.fn<Promise<any>, [any]>()
    const generate: GenerateRunner = async () => genResult()

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send: send as any,
      sendEnabled: false,
    })

    expect(summary.generated).toBe(true)
    expect(summary.guard_passed).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(summary.send_attempted).toBe(false)
    expect(summary.skipped_reason).toBe("send_disabled")
  })

  it("(d) thrown error inside generate is swallowed (never rejects)", async () => {
    const generate: GenerateRunner = async () => {
      throw new Error("LLM exploded")
    }
    const send = jest.fn<Promise<any>, [any]>()

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send: send as any,
      sendEnabled: true,
    })

    expect(summary.errored).toBe(true)
    expect(summary.skipped_reason).toBe("generate_threw")
    expect(send).not.toHaveBeenCalled()
  })

  it("(d2) thrown error inside send is swallowed (never rejects)", async () => {
    const generate: GenerateRunner = async () => genResult()
    const send: SendRunner = async () => {
      throw new Error("Resend down")
    }

    const summary = await runDailyIdeasEmail(fakeContainer, {
      generate,
      send,
      sendEnabled: true,
    })

    expect(summary.send_attempted).toBe(true)
    expect(summary.errored).toBe(true)
    expect(summary.skipped_reason).toBe("send_threw")
  })
})
