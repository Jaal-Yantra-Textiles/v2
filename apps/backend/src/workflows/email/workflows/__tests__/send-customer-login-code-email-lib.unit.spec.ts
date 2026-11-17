import {
  REDACTED_LOGIN_CODE,
  redactLoginCode,
} from "../send-customer-login-code-email-lib"

/**
 * #2543 — the sign-in code must not survive in the email log. Pure helper,
 * no container.
 */
describe("redactLoginCode", () => {
  const data = {
    code: "472375",
    expires_label: "10 minutes",
    current_year: "2026",
    _template_subject: "472375 is your Cici Label sign-in code",
    _template_html_content: "<p>472375</p><p>It works once. Again: 472375</p>",
    _template_from: "designs@jaalyantra.com",
    _template_processed: true,
  }

  it("removes every copy of the code", () => {
    const out = redactLoginCode(data, "472375")
    expect(JSON.stringify(out)).not.toContain("472375")
    expect(out.code).toBe(REDACTED_LOGIN_CODE)
    expect(out._template_subject).toBe(`${REDACTED_LOGIN_CODE} is your Cici Label sign-in code`)
    expect(out._template_html_content).toBe(
      `<p>${REDACTED_LOGIN_CODE}</p><p>It works once. Again: ${REDACTED_LOGIN_CODE}</p>`
    )
  })

  it("keeps everything else as it was", () => {
    const out = redactLoginCode(data, "472375")
    expect(out.expires_label).toBe("10 minutes")
    expect(out._template_from).toBe("designs@jaalyantra.com")
    expect(out._template_processed).toBe(true)
  })

  it("does not change the input", () => {
    redactLoginCode(data, "472375")
    expect(data.code).toBe("472375")
  })

  it("handles a missing data blob", () => {
    expect(redactLoginCode(null, "123456")).toEqual({})
  })
})
