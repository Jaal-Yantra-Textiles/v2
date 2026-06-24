import { describeFetchError } from "../describe-fetch-error"

describe("describeFetchError", () => {
  it("unwraps an undici-style TypeError with cause and full opts", () => {
    const undiciErr = Object.assign(new TypeError("fetch failed"), {
      cause: {
        code: "ETIMEDOUT",
        errno: -60,
        syscall: "connect",
        address: "157.240.1.1",
        port: 443,
      },
    })

    expect(
      describeFetchError(undiciErr, {
        url: "https://graph.facebook.com/v19.0/123/messages",
        label: "WhatsApp send",
      })
    ).toBe(
      "WhatsApp send to graph.facebook.com failed: connect ETIMEDOUT 157.240.1.1:443"
    )
  })

  it("surfaces ECONNRESET from cause when no address is present", () => {
    const resetErr = Object.assign(new TypeError("fetch failed"), {
      cause: { syscall: "read", code: "ECONNRESET" },
    })

    expect(describeFetchError(resetErr)).toBe("read ECONNRESET")
  })

  it("renders ENOTFOUND with hostname from cause", () => {
    const dnsErr = Object.assign(new TypeError("fetch failed"), {
      cause: {
        syscall: "getaddrinfo",
        code: "ENOTFOUND",
        hostname: "bad.example.com",
      },
    })

    expect(describeFetchError(dnsErr)).toBe(
      "getaddrinfo ENOTFOUND bad.example.com"
    )
  })

  it("uses err.message for a plain Error with no cause and no opts", () => {
    expect(describeFetchError(new Error("boom"))).toBe("boom")
  })

  it("stringifies non-Error thrown values", () => {
    expect(describeFetchError("kaboom")).toBe("kaboom")
    expect(describeFetchError(42)).toBe("42")
  })

  it("prefixes with only the host when url is provided without label", () => {
    expect(
      describeFetchError(new Error("boom"), {
        url: "https://api.example.com/resource",
      })
    ).toBe("api.example.com failed: boom")
  })

  it("prefixes with only the label when label is provided without url", () => {
    expect(
      describeFetchError(new Error("boom"), { label: "API call" })
    ).toBe("API call failed: boom")
  })

  it("surfaces the structured cause over a generic 'fetch failed' message", () => {
    const undiciErr = Object.assign(new TypeError("fetch failed"), {
      cause: {
        code: "ETIMEDOUT",
        errno: -60,
        syscall: "connect",
        address: "157.240.1.1",
        port: 443,
      },
    })

    expect(describeFetchError(undiciErr)).toBe(
      "connect ETIMEDOUT 157.240.1.1:443"
    )
  })
})
