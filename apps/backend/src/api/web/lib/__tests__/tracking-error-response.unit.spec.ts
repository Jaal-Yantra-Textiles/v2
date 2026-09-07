import {
  classifyTrackingRejection,
  formatTrackingWarn,
  handleTrackingError,
  isValidationError,
} from "../tracking-error-response"

/** A zod-shaped error without importing zod — mirrors what `.parse()` throws. */
const zodErr = (paths: string[][]) => ({
  name: "ZodError",
  issues: paths.map((path) => ({ code: "invalid_type", path })),
})

describe("isValidationError", () => {
  it("recognises a zod error by shape, not by instanceof", () => {
    expect(isValidationError(zodErr([["website_id"]]))).toBe(true)
    expect(isValidationError({ issues: [] })).toBe(true)
  })

  it("does NOT claim an ordinary failure is a validation error", () => {
    // The whole point: a DB outage must reach the error-level branch.
    expect(isValidationError(new Error("connect ECONNREFUSED redis:6379"))).toBe(false)
    expect(isValidationError(null)).toBe(false)
    expect(isValidationError("boom")).toBe(false)
  })
})

describe("classifyTrackingRejection", () => {
  const err = zodErr([["website_id"], ["pathname"], ["visitor_id"], ["session_id"]])

  it("calls an empty object background noise, not a broken client", () => {
    // The bot case: ~175/week of these. `req.body` is {} for a bodiless POST.
    expect(classifyTrackingRejection({}, err).kind).toBe("not_an_object")
    expect(classifyTrackingRejection(undefined, err).kind).toBe("not_an_object")
    expect(classifyTrackingRejection(null, err).kind).toBe("not_an_object")
    expect(classifyTrackingRejection("nonsense", err).kind).toBe("not_an_object")
    expect(classifyTrackingRejection([], err).kind).toBe("not_an_object")
  })

  it("singles out a real request that lost its website_id", () => {
    // A storefront whose tracker booted before website_id resolved: it HAS
    // something to say and says it about nobody. This is the alertable one.
    const r = classifyTrackingRejection(
      { pathname: "/shop", visitor_id: "v1", session_id: "s1" },
      zodErr([["website_id"]])
    )
    expect(r.kind).toBe("missing_website_id")
    expect(r.fields).toEqual(["website_id"])
  })

  it("calls a populated body with wrong details malformed", () => {
    const r = classifyTrackingRejection(
      { website_id: "web_1", event_type: "not_a_real_enum_value" },
      zodErr([["event_type"]])
    )
    expect(r.kind).toBe("malformed")
    expect(r.fields).toEqual(["event_type"])
  })

  it("de-duplicates field paths and joins nested ones", () => {
    const r = classifyTrackingRejection(
      { website_id: "web_1", metadata: {} },
      zodErr([["metadata", "utm"], ["metadata", "utm"], ["event_data", "id"]])
    )
    expect(r.fields).toEqual(["metadata.utm", "event_data.id"])
  })
})

describe("formatTrackingWarn", () => {
  it("is one line with no stack and no zod dump", () => {
    const line = formatTrackingWarn("analytics-track", {
      kind: "missing_website_id",
      fields: ["website_id"],
    })
    expect(line).toBe("[analytics-track] rejected (missing_website_id): website_id")
    expect(line.split("\n")).toHaveLength(1)
  })
})

describe("handleTrackingError", () => {
  const makeRes = () => {
    const json = jest.fn()
    return { res: { status: jest.fn(() => ({ json })) } as any, json }
  }
  const makeLogger = () => ({ warn: jest.fn(), error: jest.fn() })

  it("answers a malformed body with 400 and ONE warn line, never an error", () => {
    const { res, json } = makeRes()
    const logger = makeLogger()

    const handled = handleTrackingError({
      error: zodErr([["website_id"]]),
      body: {},
      logger,
      label: "analytics-track",
      res,
    })

    expect(handled).toBe(true)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(json.mock.calls[0][0]).toEqual({
      success: false,
      message: "Invalid tracking payload",
      fields: ["website_id"],
    })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    // The regression this whole change exists to prevent.
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("declines an unexpected failure so the caller keeps error-level + 200", () => {
    const { res } = makeRes()
    const logger = makeLogger()

    const handled = handleTrackingError({
      error: new Error("connect ECONNREFUSED redis:6379"),
      body: { website_id: "web_1" },
      logger,
      label: "analytics-track",
      res,
    })

    expect(handled).toBe(false)
    expect(res.status).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("never echoes the submitted values back — field names only", () => {
    const { res, json } = makeRes()
    handleTrackingError({
      error: zodErr([["visitor_id"]]),
      body: { website_id: "web_1", visitor_id: { evil: "<script>" } },
      logger: makeLogger(),
      label: "analytics-track",
      res,
    })
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("script")
  })
})
