/**
 * A withdrawn quote or cancelled design order used to reach the buyer as a
 * dead link. The notice is ON unless a caller explicitly says false.
 */
import { decideBuyerNotice } from "../notify-buyer-of-withdrawal"

describe("decideBuyerNotice", () => {
  it("sends when the flag is missing — a missing field never suppresses the notice", () => {
    expect(decideBuyerNotice({ notify: undefined, to: "elly@example.com" })).toEqual({
      send: true,
      to: "elly@example.com",
    })
  })

  it("sends on an explicit true, trimming the address", () => {
    expect(decideBuyerNotice({ notify: true, to: "  elly@example.com " })).toEqual({
      send: true,
      to: "elly@example.com",
    })
  })

  it("stays silent only on an explicit false", () => {
    const d = decideBuyerNotice({ notify: false, to: "elly@example.com" })
    expect(d.send).toBe(false)
  })

  it("treats a stringly 'false' as notify — only the boolean opts out", () => {
    expect(decideBuyerNotice({ notify: "false", to: "elly@example.com" }).send).toBe(true)
  })

  it("cannot send with no buyer email, and says so", () => {
    const d = decideBuyerNotice({ notify: true, to: "   " })
    expect(d.send).toBe(false)
    if (d.send) return
    expect(d.reason).toMatch(/no buyer email/)
  })
})
