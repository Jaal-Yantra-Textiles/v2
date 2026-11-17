import { describe, expect, it } from "vitest"

import {
  describeOtpError,
  findSignInRequired,
  isCompleteCode,
  isValidEmail,
  needsNewCode,
  normalizeCodeInput,
  resendSecondsLeft,
} from "../email-otp"

describe("design studio email sign-in helpers (#2543)", () => {
  it("keeps only digits from a typed or pasted code, max 6", () => {
    expect(normalizeCodeInput("123 456")).toBe("123456")
    expect(normalizeCodeInput("Code: 004817!")).toBe("004817")
    expect(normalizeCodeInput("1234567")).toBe("123456")
    expect(isCompleteCode("004817")).toBe(true)
    expect(isCompleteCode("12345")).toBe(false)
  })

  it("validates emails", () => {
    expect(isValidEmail(" Maker@Example.com ")).toBe(true)
    expect(isValidEmail("maker@")).toBe(false)
  })

  it("counts down the resend cooldown", () => {
    expect(resendSecondsLeft(null, 1_000)).toBe(0)
    expect(resendSecondsLeft(1_000, 1_000)).toBe(30)
    expect(resendSecondsLeft(1_000, 21_500)).toBe(10)
    expect(resendSecondsLeft(1_000, 60_000)).toBe(0)
  })

  it("says what went wrong in buyer words, and when to resend", () => {
    expect(describeOtpError("invalid_code")).toMatch(/isn't right/)
    expect(describeOtpError("code_expired")).toMatch(/expired/)
    expect(describeOtpError("rate_limited", 600)).toMatch(/10 min/)
    expect(needsNewCode("too_many_attempts")).toBe(true)
    expect(needsNewCode("invalid_code")).toBe(false)
  })

  it("spots sign_in_required on the latest assistant turn only", () => {
    const needs = {
      role: "assistant",
      parts: [
        {
          type: "tool-create_design",
          state: "output-available",
          output: { sign_in_required: true, message: "verify" },
        },
      ],
    }
    expect(findSignInRequired([{ role: "user", parts: [] }, needs])).toBe(true)
    // An old refusal followed by a later turn does not reopen the panel.
    expect(
      findSignInRequired([needs, { role: "user", parts: [] }, { role: "assistant", parts: [{ type: "text", text: "ok" }] }])
    ).toBe(false)
    expect(
      findSignInRequired([
        { role: "assistant", parts: [{ type: "tool-create_design", state: "output-available", output: { design_id: "d" } }] },
      ])
    ).toBe(false)
  })
})
