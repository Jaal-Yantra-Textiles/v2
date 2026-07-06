import { formatGoogleAdsError, googleErrorRoot } from "../sync-google-ads-step"

/** Build an axios-like error with a given response body + status. */
const axiosErr = (status: number, data: any) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data },
})

/** searchStream error body: an ARRAY wrapping the error object. */
const streamError = (code: Record<string, string>, message: string) => [
  { error: { message, details: [{ errors: [{ errorCode: code, message }] }] } },
]

describe("googleErrorRoot", () => {
  it("unwraps the array-shaped searchStream error body", () => {
    expect(googleErrorRoot([{ error: { message: "x" } }])).toEqual({ error: { message: "x" } })
  })
  it("passes through the plain object shape (unary endpoints)", () => {
    expect(googleErrorRoot({ error: { message: "y" } })).toEqual({ error: { message: "y" } })
  })
  it("tolerates null/empty", () => {
    expect(googleErrorRoot(null)).toBeNull()
    expect(googleErrorRoot([])).toBeNull()
  })
})

describe("formatGoogleAdsError — array-shaped searchStream 400", () => {
  it("decodes a manager-metrics 400 and appends the MCC hint (previously a bare message)", () => {
    const e = axiosErr(
      400,
      streamError(
        { queryError: "REQUESTED_METRICS_FOR_MANAGER" },
        "Metrics cannot be requested for a manager account."
      )
    )
    const msg = formatGoogleAdsError(e, { hasLoginCid: true })
    expect(msg).toContain("Metrics cannot be requested for a manager account")
    expect(msg).toContain("[queryError:REQUESTED_METRICS_FOR_MANAGER]")
    expect(msg).toContain("manager (MCC) account")
  })

  it("decodes a generic GAQL 400 (bad field) with a query hint", () => {
    const e = axiosErr(
      400,
      streamError({ queryError: "BAD_FIELD_NAME" }, "Unrecognized field: metrics.foo")
    )
    const msg = formatGoogleAdsError(e, { hasLoginCid: false })
    expect(msg).toContain("Unrecognized field: metrics.foo")
    expect(msg).toContain("GAQL query rejected (400)")
  })

  it("still surfaces a bare axios message when Google gives no parseable body", () => {
    const msg = formatGoogleAdsError(axiosErr(400, undefined), { hasLoginCid: true })
    expect(msg).toContain("Request failed with status code 400")
  })

  it("regression: plain-object 403 developer-token error still hinted", () => {
    const e = axiosErr(403, {
      error: {
        message: "The developer token is not approved.",
        details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "not approved" }] }],
      },
    })
    const msg = formatGoogleAdsError(e, { hasLoginCid: true })
    expect(msg).toContain("Test access")
  })
})
