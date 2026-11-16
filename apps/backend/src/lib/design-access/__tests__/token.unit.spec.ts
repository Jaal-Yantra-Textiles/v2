import {
  DESIGN_TOKEN_VERSION,
  mintConversationAccessToken,
  mintDesignAccessToken,
  verifyConversationAccessToken,
  verifyDesignAccessToken,
} from "../token"

/**
 * #2543 — the design access token is the ONLY thing standing between a guest
 * maker's board and anyone who can type its id. Every way of presenting the
 * wrong thing must come back null.
 */
describe("design access token", () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.JWT_SECRET = "unit-test-secret"
    delete process.env.DESIGN_ACCESS_TOKEN_SECRET
  })
  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  const DESIGN = "01KDESIGNAAAAAAAAAAAAAAAAA"
  const OTHER = "01KDESIGNBBBBBBBBBBBBBBBBB"
  const CUSTOMER = "cus_01KCUSTOMERAAAAAAAAAAAAA"

  it("mints a versioned token that verifies for its design", () => {
    const token = mintDesignAccessToken(DESIGN, CUSTOMER)
    expect(token.startsWith(`${DESIGN_TOKEN_VERSION}.${DESIGN}.`)).toBe(true)
    expect(verifyDesignAccessToken(token, DESIGN)).toEqual({
      design_id: DESIGN,
      customer_id: CUSTOMER,
    })
  })

  it("carries no customer when none is known", () => {
    const token = mintDesignAccessToken(DESIGN)
    expect(verifyDesignAccessToken(token, DESIGN)).toEqual({
      design_id: DESIGN,
      customer_id: null,
    })
  })

  it("🔴 refuses a valid token presented for a DIFFERENT design", () => {
    const token = mintDesignAccessToken(OTHER, CUSTOMER)
    expect(verifyDesignAccessToken(token, DESIGN)).toBeNull()
  })

  it("🔴 refuses a token whose design id was swapped (signature no longer matches)", () => {
    const token = mintDesignAccessToken(OTHER, CUSTOMER)
    const [v, , c, sig] = token.split(".")
    expect(verifyDesignAccessToken([v, DESIGN, c, sig].join("."), DESIGN)).toBeNull()
  })

  it("🔴 refuses a token whose customer was swapped", () => {
    const token = mintDesignAccessToken(DESIGN, CUSTOMER)
    const [v, d, , sig] = token.split(".")
    expect(verifyDesignAccessToken([v, d, "cus_attacker", sig].join("."), DESIGN)).toBeNull()
  })

  it("🔴 refuses a tampered signature", () => {
    const token = mintDesignAccessToken(DESIGN, CUSTOMER)
    const last = token.slice(-1)
    const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A")
    expect(verifyDesignAccessToken(flipped, DESIGN)).toBeNull()
  })

  it("🔴 refuses a token signed with another secret", () => {
    const token = mintDesignAccessToken(DESIGN, CUSTOMER)
    process.env.JWT_SECRET = "a-different-secret"
    expect(verifyDesignAccessToken(token, DESIGN)).toBeNull()
  })

  it("🔴 refuses another version prefix, garbage, and non-strings", () => {
    const token = mintDesignAccessToken(DESIGN, CUSTOMER)
    expect(verifyDesignAccessToken(token.replace(/^dt1/, "dt2"), DESIGN)).toBeNull()
    expect(verifyDesignAccessToken("", DESIGN)).toBeNull()
    expect(verifyDesignAccessToken("dt1.x.y", DESIGN)).toBeNull()
    expect(verifyDesignAccessToken(undefined, DESIGN)).toBeNull()
    expect(verifyDesignAccessToken(null, DESIGN)).toBeNull()
    expect(verifyDesignAccessToken({ token } as any, DESIGN)).toBeNull()
    expect(verifyDesignAccessToken("x".repeat(500), DESIGN)).toBeNull()
  })

  it("🔴 a conversation token never passes as a design token (and vice versa)", () => {
    const conv = mintConversationAccessToken(DESIGN)
    expect(verifyDesignAccessToken(conv, DESIGN)).toBeNull()
    const design = mintDesignAccessToken(DESIGN)
    expect(verifyConversationAccessToken(design, DESIGN)).toBe(false)
  })

  it("conversation tokens bind their conversation id", () => {
    const conv = mintConversationAccessToken("01KCONVAAAAAAAAAAAAAAAAAAA")
    expect(verifyConversationAccessToken(conv, "01KCONVAAAAAAAAAAAAAAAAAAA")).toBe(true)
    expect(verifyConversationAccessToken(conv, "01KCONVBBBBBBBBBBBBBBBBBBB")).toBe(false)
  })

  it("refuses to mint for a malformed id (a dot would break the format)", () => {
    expect(() => mintDesignAccessToken("a.b")).toThrow()
    expect(() => mintDesignAccessToken("")).toThrow()
  })

  it("🔴 never signs with the public default in production", () => {
    delete process.env.JWT_SECRET
    delete process.env.COOKIE_SECRET
    const env = process.env as Record<string, string | undefined>
    const prev = env.NODE_ENV
    env.NODE_ENV = "production"
    try {
      expect(() => mintDesignAccessToken(DESIGN)).toThrow(/JWT_SECRET/)
    } finally {
      env.NODE_ENV = prev
    }
  })
})
