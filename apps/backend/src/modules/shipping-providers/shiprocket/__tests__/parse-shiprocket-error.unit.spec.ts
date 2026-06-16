import { parseShiprocketError } from "../client"

describe("parseShiprocketError (#427)", () => {
  it("extracts the 422 validation bag into a readable message + per-field errors", () => {
    const body = JSON.stringify({
      message: {
        address: ["Address line 1 should have House no / Flat no / Road no."],
        email: ["The email field is required."],
      },
    })

    const { message, fieldErrors } = parseShiprocketError(body)

    expect(fieldErrors).toEqual({
      address: ["Address line 1 should have House no / Flat no / Road no."],
      email: ["The email field is required."],
    })
    expect(message).toContain(
      "address: Address line 1 should have House no / Flat no / Road no."
    )
    expect(message).toContain("email: The email field is required.")
  })

  it("extracts a flat auth message (string in `message`)", () => {
    const body = JSON.stringify({
      message: "Invalid email and password combination",
      status_code: 403,
    })

    const { message, fieldErrors } = parseShiprocketError(body)

    expect(message).toBe("Invalid email and password combination")
    expect(fieldErrors).toBeUndefined()
  })

  it("handles an `errors` bag the same as `message`", () => {
    const body = JSON.stringify({ errors: { phone: ["Phone is invalid."] } })

    const { message, fieldErrors } = parseShiprocketError(body)

    expect(fieldErrors).toEqual({ phone: ["Phone is invalid."] })
    expect(message).toBe("phone: Phone is invalid.")
  })

  it("returns a plain non-JSON body verbatim", () => {
    const { message, fieldErrors } = parseShiprocketError("Bad Gateway")
    expect(message).toBe("Bad Gateway")
    expect(fieldErrors).toBeUndefined()
  })

  it("handles a bare JSON string body", () => {
    const { message } = parseShiprocketError(JSON.stringify("Unauthorized"))
    expect(message).toBe("Unauthorized")
  })
})
