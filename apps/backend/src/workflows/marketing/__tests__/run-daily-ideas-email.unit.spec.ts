import {
  runDailyIdeasEmail,
  isSendEnabled,
  type GenerateRunner,
  type SendRunner,
} from "../run-daily-ideas-email"
import type { GenerateIdeasEmailResult } from "../generate-ideas-email"
import type { SendIdeasEmailResult } from "../send-ideas-email"

/**
 * #659 slice 2 — unit tests for the visual-flow orchestrator (no container LLM,
 * no real email). The two workflow `.run()` calls are INJECTED as stubs so CI
 * never touches a model or mailer. Covers the four contract cases:
 *   (a) guard-passed → send runner invoked with the log id
 *   (b) guard-failed / skipped → send NOT invoked
 *   (c) send disabled by the gate → generate ran, send skipped
 *   (d) a thrown error inside either runner is swallowed (never rejects)
 */

// Minimal container stub — only `.resolve(LOGGER)` is exercised; we let it throw
// so the orchestrator falls back to `console`, proving the resolve is optional.
const container: any = {
  resolve: () => {
    throw new Error("no logger in unit test")
  },
}

const baseGen = (over: Partial<GenerateIdeasEmailResult> = {}): GenerateIdeasEmailResult => ({
  skipped: false,
  generated: true,
  guard_passed: true,
  regenerated: false,
  log_id: "log_123",
  output_text: "ideas",
  model_used: "stub",
  ground_truth: null,
  ...over,
})

const baseSend = (over: Partial<SendIdeasEmailResult> = {}): SendIdeasEmailResult => ({
  sent: 2,
  skipped: false,
  guard_passed: true,
  review_notice_sent: false,
  recipients: 2,
  ...over,
})

describe("runDailyIdeasEmail", () => {
  it("(a) guard-passed + send enabled → invokes send with the log id", async () => {
    const sendCalls: any[] = []
    const generate: GenerateRunner = async () => baseGen()
    const send: SendRunner = async (input) => {
      sendCalls.push(input)
      return baseSend({ sent: 3, recipients: 3 })
    }

    const summary = await runDailyIdeasEmail(container, {
      generate,
      send,
      sendEnabled: true,
    })

    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]).toEqual({ logId: "log_123" })
    expect(summary).toMatchObject({
      generated: true,
      guard_passed: true,
      log_id: "log_123",
      send_enabled: true,
      send_attempted: true,
      sent: 3,
      errored: false,
      skipped_reason: null,
    })
  })

  it("(a') forwards an explicit recipients override into the send input", async () => {
    const sendCalls: any[] = []
    const summary = await runDailyIdeasEmail(container, {
      generate: async () => baseGen(),
      send: async (input) => {
        sendCalls.push(input)
        return baseSend()
      },
      sendEnabled: true,
      recipients: ["a@x.com", "b@x.com"],
    })
    expect(sendCalls[0]).toEqual({
      logId: "log_123",
      recipients: ["a@x.com", "b@x.com"],
    })
    expect(summary.send_attempted).toBe(true)
  })

  it("(b) guard-failed → does NOT invoke send", async () => {
    let sendInvoked = false
    const summary = await runDailyIdeasEmail(container, {
      generate: async () => baseGen({ guard_passed: false, reason: "guard_failed" }),
      send: async () => {
        sendInvoked = true
        return baseSend()
      },
      sendEnabled: true,
    })

    expect(sendInvoked).toBe(false)
    expect(summary.send_attempted).toBe(false)
    expect(summary.sent).toBe(0)
    expect(summary.guard_passed).toBe(false)
    expect(summary.skipped_reason).toBe("guard_failed")
  })

  it("(b') skipped generate → does NOT invoke send", async () => {
    let sendInvoked = false
    const summary = await runDailyIdeasEmail(container, {
      generate: async () =>
        baseGen({ skipped: true, generated: false, guard_passed: false, log_id: null }),
      send: async () => {
        sendInvoked = true
        return baseSend()
      },
      sendEnabled: true,
    })
    expect(sendInvoked).toBe(false)
    expect(summary.send_attempted).toBe(false)
    expect(summary.skipped_reason).toBe("generate_skipped")
  })

  it("(c) send disabled by gate → generate ran, send skipped", async () => {
    let sendInvoked = false
    const summary = await runDailyIdeasEmail(container, {
      generate: async () => baseGen(),
      send: async () => {
        sendInvoked = true
        return baseSend()
      },
      sendEnabled: false,
    })

    expect(sendInvoked).toBe(false)
    expect(summary.generated).toBe(true)
    expect(summary.guard_passed).toBe(true)
    expect(summary.send_enabled).toBe(false)
    expect(summary.send_attempted).toBe(false)
    expect(summary.skipped_reason).toBe("send_disabled")
  })

  it("(d) a thrown error in generate is swallowed (never rejects)", async () => {
    const summary = await runDailyIdeasEmail(container, {
      generate: async () => {
        throw new Error("LLM boom")
      },
      send: async () => baseSend(),
      sendEnabled: true,
    })
    expect(summary.errored).toBe(true)
    expect(summary.skipped_reason).toBe("generate_threw")
    expect(summary.send_attempted).toBe(false)
  })

  it("(d') a thrown error in send is swallowed (never rejects)", async () => {
    const summary = await runDailyIdeasEmail(container, {
      generate: async () => baseGen(),
      send: async () => {
        throw new Error("mailer boom")
      },
      sendEnabled: true,
    })
    expect(summary.errored).toBe(true)
    expect(summary.skipped_reason).toBe("send_threw")
    expect(summary.send_attempted).toBe(true)
    expect(summary.sent).toBe(0)
  })
})

describe("isSendEnabled", () => {
  it("is true only for truthy env vocabulary", () => {
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "true" } as any)).toBe(true)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "1" } as any)).toBe(true)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "on" } as any)).toBe(true)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "false" } as any)).toBe(false)
    expect(isSendEnabled({ MARKETING_IDEAS_EMAIL_ENABLED: "" } as any)).toBe(false)
    expect(isSendEnabled({} as any)).toBe(false)
  })
})
