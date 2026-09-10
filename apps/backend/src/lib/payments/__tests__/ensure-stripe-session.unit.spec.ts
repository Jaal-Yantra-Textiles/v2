import {
  isCollectionSettled,
  pickStripeSession,
} from "../ensure-stripe-session"
import { collectionPayPath } from "../../../api/payment-collection/[id]/route"

/**
 * The collection an order EDIT leaves behind (#1985). Figures are the live EUR
 * order that exposed the gap: `order_01KNP520PT94BN8SC0JKZ6ZVJ9` was edited
 * onto five rebuilt products, leaving `pay_col_01M25NHFRS498JEP8PY4CNS8DC` at
 * €174.97, `not_paid`, with NO payment sessions at all — so "Copy payment link"
 * had nothing to link to.
 */
const EDIT_COLLECTION = {
  id: "pay_col_01M25NHFRS498JEP8PY4CNS8DC",
  amount: 174.97,
  status: "not_paid",
  currency_code: "eur",
  payment_sessions: [],
  payments: [],
}

/** The order's ORIGINAL collection: €335.39, paid through Stripe. */
const PAID_COLLECTION = {
  id: "pay_col_01KNATK6D6ASRP2GEZ81ZVFWS8",
  amount: 335.39,
  status: "completed",
  currency_code: "eur",
  payment_sessions: [
    {
      id: "payses_01KNBJ3JMB0HMS6PSCZ4CXKKF9",
      provider_id: "pp_stripe_stripe",
      status: "authorized",
      data: { client_secret: "pi_123_secret_abc" },
    },
  ],
  payments: [
    {
      id: "pay_01KNP522S2H9B790VQSJA01098",
      amount: 335.39,
      captured_at: "2026-04-08T08:59:01.731Z",
    },
  ],
}

describe("pickStripeSession", () => {
  it("returns null when the collection has no sessions at all", () => {
    // The live order-edit case: nothing mints a session, so there is no
    // client_secret and nothing for a buyer to pay against.
    expect(pickStripeSession(EDIT_COLLECTION)).toBeNull()
  })

  it("finds the standard Stripe session", () => {
    expect(pickStripeSession(PAID_COLLECTION)?.id).toBe(
      "payses_01KNBJ3JMB0HMS6PSCZ4CXKKF9"
    )
  })

  /**
   * 🔴 The regression this guards. A Connect-routed session does NOT carry
   * `pp_stripe_stripe` — it is `pp_stripe-connect_stripe-connect`. An exact-id
   * match would miss it, report "no session", and mint a SECOND PaymentIntent
   * for money the buyer may already be part-way through paying.
   */
  it("finds a Stripe CONNECT session, whose provider id differs", () => {
    const connect = {
      payment_sessions: [
        {
          id: "payses_connect",
          provider_id: "pp_stripe-connect_stripe-connect",
          data: { client_secret: "pi_c_secret" },
        },
      ],
    }
    expect(pickStripeSession(connect)?.id).toBe("payses_connect")
  })

  it("ignores a non-Stripe session", () => {
    const payu = {
      payment_sessions: [{ id: "payses_payu", provider_id: "pp_payu_payu" }],
    }
    expect(pickStripeSession(payu)).toBeNull()
  })

  it("survives a missing or malformed collection", () => {
    expect(pickStripeSession(undefined)).toBeNull()
    expect(pickStripeSession({})).toBeNull()
    expect(pickStripeSession({ payment_sessions: [{}] })).toBeNull()
  })
})

describe("isCollectionSettled", () => {
  it("is false for the outstanding edit collection", () => {
    expect(isCollectionSettled(EDIT_COLLECTION)).toBe(false)
  })

  it("is true for a completed collection", () => {
    expect(isCollectionSettled(PAID_COLLECTION)).toBe(true)
  })

  it.each(["completed", "authorized", "paid"])(
    "treats status %s as settled",
    (status) => {
      expect(isCollectionSettled({ status, payments: [] })).toBe(true)
    }
  )

  /**
   * The webhook window: Stripe has captured and the payment row records it,
   * but the collection status has not caught up. Showing the payment form here
   * would invite a second charge.
   */
  it("is true when a payment is captured even if status lags", () => {
    expect(
      isCollectionSettled({
        status: "not_paid",
        payments: [{ id: "pay_1", captured_at: "2026-09-10T12:00:00.000Z" }],
      })
    ).toBe(true)
  })

  it("is false when a payment row exists but nothing captured", () => {
    expect(
      isCollectionSettled({
        status: "not_paid",
        payments: [{ id: "pay_1", captured_at: null }],
      })
    ).toBe(false)
  })

  it("survives a missing or malformed collection", () => {
    expect(isCollectionSettled(undefined)).toBe(false)
    expect(isCollectionSettled({})).toBe(false)
  })
})

describe("collectionPayPath", () => {
  it("forwards a real collection id to the hosted page", () => {
    expect(collectionPayPath("pay_col_01M25NHFRS498JEP8PY4CNS8DC")).toBe(
      "/stripe/pay/collection/pay_col_01M25NHFRS498JEP8PY4CNS8DC"
    )
  })

  /**
   * 🔴 The id arrives from a URL and a `Location` header is built from it.
   * Anything that could steer the redirect elsewhere must be refused, not
   * escaped — a rejected link 404s, which is recoverable; an open redirect on
   * a payment page is not.
   */
  it.each([
    ["a protocol-relative host", "//evil.example.com"],
    ["an absolute URL", "https://evil.example.com"],
    ["a path traversal", "../../admin/users"],
    ["a nested path", "abc/def"],
    ["a CRLF header injection", "abc\r\nLocation: https://evil.example.com"],
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("refuses %s", (_label, id) => {
    expect(collectionPayPath(id)).toBeNull()
  })

  it("refuses a non-string id", () => {
    expect(collectionPayPath(undefined)).toBeNull()
    expect(collectionPayPath(null)).toBeNull()
    expect(collectionPayPath(123 as any)).toBeNull()
  })

  it("refuses an absurdly long id rather than emitting it", () => {
    expect(collectionPayPath("a".repeat(129))).toBeNull()
    expect(collectionPayPath("a".repeat(128))).toBe(
      `/stripe/pay/collection/${"a".repeat(128)}`
    )
  })
})
