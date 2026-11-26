import * as fs from "fs"
import * as path from "path"
import * as Handlebars from "handlebars"

jest.mock("../../../../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))
const deactivatePayuLink = jest.fn()
jest.mock("../../../../../lib/payments/payu-link-admin", () => ({
  deactivatePayuLink: (...a: any[]) => deactivatePayuLink(...a),
}))

import { applyDesignOrderDeposit, depositRefusalStatus } from "../apply-deposit"
import {
  CreateDesignDraftOrderSchema,
  CreateDesignOrderSchema,
} from "../../../customers/[id]/design-order/validators"
import { previewDeposit } from "../../../customers/[id]/design-order/preview/preview-deposit"
import { closeTrackedPayuLink } from "../../../../../lib/payments/payu-cart-link"
import { decideDepositRebase } from "../../../../../lib/payments/deposit-rebase"

/**
 * #2645 — a deposit given at creation, and one set later, go through ONE
 * function. These pin the pieces that decide money without a database.
 */

describe("depositRefusalStatus — the deposit route's status codes are unchanged", () => {
  it.each([
    ["no_cart", 404],
    ["not_a_pct", 400],
    ["not_an_amount", 400],
    ["pct_and_amount", 400],
    ["bad_balance_trigger", 400],
    ["no_total", 400],
    ["cart_completed", 409],
    ["cancelled", 409],
    ["already_has_deposit", 409],
  ])("%s → %i", (reason, status) => {
    expect(depositRefusalStatus(reason)).toBe(status)
  })
})

const scopeFor = (opts: { cart: any; schedule?: any; collectionPayments?: any[] }) => {
  const openForCart = jest.fn(async (i: any) => ({
    id: "psch_new",
    deposit_pct: i.quote_deposit_pct,
    deposit_amount: i.quote_deposit_pct ? (i.total_due * i.quote_deposit_pct) / 100 : i.fixed_deposit_amount,
    balance_amount: 0,
    balance_trigger: i.balance_trigger,
  }))
  const deletePaymentCollections = jest.fn()
  const dismiss = jest.fn()
  const scope = {
    resolve: (key: string) => {
      if (key === "logger") return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      if (key === "query") return { graph: jest.fn(async () => ({ data: [opts.cart] })) }
      if (key === "cart")
        return { listLineItems: jest.fn(async () => [{ id: "cali_1", cart_id: opts.cart.id }]) }
      if (key === "payment_schedule")
        return {
          findByCartId: jest.fn(async () => opts.schedule ?? null),
          openForCart,
          replaceManualDeposit: jest.fn(),
        }
      if (key === "link") return { dismiss }
      if (key === "payment") return { deletePaymentCollections }
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  return { scope, openForCart, deletePaymentCollections, dismiss }
}

describe("applyDesignOrderDeposit", () => {
  const base = { lineItemId: "cali_1", designId: "des_1", hasLinkedOrder: false }

  it("opens a manual schedule on the cart, PayU rail for INR, source = the line", async () => {
    const { scope, openForCart } = scopeFor({
      cart: { id: "cart_1", currency_code: "inr", total: 25200, metadata: {} },
    })
    const out = await applyDesignOrderDeposit(scope, { ...base, depositPct: 50 })
    expect(out.ok).toBe(true)
    expect(openForCart).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_id: "cart_1",
        source_type: "manual",
        source_id: "cali_1",
        rail: "payu",
        total_due: 25200,
        quote_deposit_pct: 50,
        fixed_deposit_amount: null,
        balance_trigger: "manual",
      })
    )
  })

  it("clears an UNPAID full-total collection so checkout makes the deposit one", async () => {
    const { scope, deletePaymentCollections, dismiss } = scopeFor({
      cart: {
        id: "cart_1",
        currency_code: "usd",
        total: 100,
        payment_collection: { id: "pay_col_1", amount: 100, payments: [] },
      },
    })
    const out = await applyDesignOrderDeposit(scope, { ...base, depositPct: 10 })
    expect(out.ok && out.deposit.cleared_payment_collection_id).toBe("pay_col_1")
    expect(dismiss).toHaveBeenCalled()
    expect(deletePaymentCollections).toHaveBeenCalledWith(["pay_col_1"])
  })

  it("refuses (409) a collection that already holds a payment, and opens nothing", async () => {
    const { scope, openForCart } = scopeFor({
      cart: {
        id: "cart_1",
        currency_code: "usd",
        total: 100,
        payment_collection: { id: "pay_col_1", amount: 100, payments: [{ id: "pay_1" }] },
      },
    })
    const out = await applyDesignOrderDeposit(scope, { ...base, depositPct: 10 })
    expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, reason: "collection_has_payments" }))
    expect(openForCart).not.toHaveBeenCalled()
  })

  it("refuses (400) a fixed deposit that is not below the real total", async () => {
    const { scope, openForCart } = scopeFor({
      cart: { id: "cart_1", currency_code: "inr", total: 800 },
    })
    const out = await applyDesignOrderDeposit(scope, { ...base, depositAmount: 800 })
    expect(out).toEqual(expect.objectContaining({ ok: false, status: 400, reason: "not_an_amount" }))
    expect(openForCart).not.toHaveBeenCalled()
  })
})

describe("create-design-order body — deposit fields", () => {
  const ok = { design_ids: ["des_1"] }
  it("accepts a percentage, or a fixed amount, with a balance trigger", () => {
    expect(CreateDesignDraftOrderSchema.safeParse({ ...ok, deposit_pct: 50 }).success).toBe(true)
    expect(
      CreateDesignDraftOrderSchema.safeParse({ ...ok, deposit_amount: 800, balance_trigger: "dispatch" })
        .success
    ).toBe(true)
    expect(CreateDesignOrderSchema.safeParse({ ...ok, deposit_pct: 30 }).success).toBe(true)
  })
  it.each([
    [{ deposit_pct: 0 }],
    [{ deposit_pct: 100 }],
    [{ deposit_pct: "50" }],
    [{ deposit_amount: 0 }],
    [{ deposit_pct: 50, deposit_amount: 800 }],
    [{ balance_trigger: "dispatch" }],
    [{ deposit_pct: 50, balance_trigger: "later" }],
  ])("rejects %j", (extra) => {
    expect(CreateDesignDraftOrderSchema.safeParse({ ...ok, ...extra }).success).toBe(false)
  })
  it("an order with no deposit still parses exactly as before", () => {
    const r = CreateDesignDraftOrderSchema.safeParse({ ...ok, customer_id: "cus_1", country_code: "IN" })
    expect(r.success && r.data.country_code).toBe("in")
  })
})

describe("previewDeposit", () => {
  it("splits the pre-tax total, balance as the remainder", () => {
    expect(previewDeposit({ total: 24000, complete: true, deposit_pct: 50 })).toEqual(
      expect.objectContaining({ deposit_pct: 50, deposit_amount: 12000, balance_amount: 12000, balance_trigger: "manual" })
    )
  })
  it("is null with no deposit, or on a partial total", () => {
    expect(previewDeposit({ total: 24000, complete: true })).toBeNull()
    expect(previewDeposit({ total: 24000, complete: false, deposit_pct: 50 })).toBeNull()
  })
  it("says a fixed amount at or above the total would be refused", () => {
    expect(previewDeposit({ total: 800, complete: true, deposit_amount: 800 })!.balance_amount).toBeNull()
  })
})

describe("closeTrackedPayuLink — notify_buyer:false still stops the old full-total link", () => {
  const scopeWithLink = (link: any) => {
    const updateCarts = jest.fn()
    return {
      updateCarts,
      scope: {
        resolve: (key: string) =>
          key === "cart"
            ? {
                listCarts: jest.fn(async () => [{ id: "cart_1", metadata: { a: 1, payu_link: link } }]),
                updateCarts,
              }
            : { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      },
    }
  }
  beforeEach(() => deactivatePayuLink.mockReset())

  it("switches an open link off at PayU and stamps it closed", async () => {
    deactivatePayuLink.mockResolvedValue({ ok: true, error: null })
    const { scope, updateCarts } = scopeWithLink({ invoice_number: "inv_full", expires_at: "2026-11-28T00:00:00Z", closed_at: null })
    const out = await closeTrackedPayuLink(scope, "cart_1", "deposit_set", { now: new Date("2026-11-27T00:00:00Z") })
    expect(deactivatePayuLink).toHaveBeenCalledWith("inv_full")
    expect(out.closed_invoice_number).toBe("inv_full")
    expect(updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: {
        a: 1,
        payu_link: expect.objectContaining({
          invoice_number: "inv_full",
          closed_at: "2026-11-27T00:00:00.000Z",
          closed_reason: "deposit_set",
        }),
      },
    })
  })

  it("does nothing for a link already closed", async () => {
    const { scope } = scopeWithLink({ invoice_number: "inv_full", expires_at: "2026-11-28T00:00:00Z", closed_at: "2026-11-01" })
    expect((await closeTrackedPayuLink(scope, "cart_1", "deposit_set")).closed_invoice_number).toBeNull()
    expect(deactivatePayuLink).not.toHaveBeenCalled()
  })

  it("reports (never throws) when PayU refuses, and does not stamp it closed", async () => {
    deactivatePayuLink.mockResolvedValue({ ok: false, error: "nope" })
    const { scope, updateCarts } = scopeWithLink({ invoice_number: "inv_full", expires_at: "2026-11-28T00:00:00Z", closed_at: null })
    const out = await closeTrackedPayuLink(scope, "cart_1", "deposit_set")
    expect(out).toEqual({ closed_invoice_number: null, error: "nope" })
    expect(updateCarts).not.toHaveBeenCalled()
  })
})

describe("decideDepositRebase", () => {
  it("#176: 195 collected on a 50% deposit of 195 is an overcharge; planned figures kept", () => {
    expect(
      decideDepositRebase({ orderTotal: 195, collected: 195, depositPct: 50, fixedDeposit: 97.5 })
    ).toEqual(
      expect.objectContaining({ kind: "over", planned: 97.5, write: { total: 195, deposit: 97.5, balance: 97.5 } })
    )
  })
  it("Number(null) is not a 0% deposit: a fixed deposit is compared on its amount", () => {
    expect(
      decideDepositRebase({ orderTotal: 8400, collected: 800, depositPct: null, fixedDeposit: 800 }).kind
    ).toBe("match")
  })
  it("skips nonsense figures", () => {
    expect(decideDepositRebase({ orderTotal: 0, collected: 10, depositPct: 50, fixedDeposit: 5 }).kind).toBe("skip")
    expect(decideDepositRebase({ orderTotal: 100, collected: 0, depositPct: 50, fixedDeposit: 5 }).kind).toBe("skip")
  })
})

/**
 * The live template is applied by the operator from this file, so it must
 * compile, show the deposit when there is one, and render EXACTLY the old
 * wording when there is not.
 */
describe("design-order-created template (src/scripts/templates)", () => {
  const dir = path.join(__dirname, "../../../../../scripts/templates")
  const html = fs.readFileSync(path.join(dir, "design-order-created.html"), "utf8")
  const hb = Handlebars.create()
  hb.registerHelper("formatMoney", (cur: string, amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: String(cur).toUpperCase() }).format(
      Number(amount) || 0
    )
  )
  const render = (data: any) => hb.compile(html)(data)
  const base = {
    cart_id: "cart_1",
    checkout_url: "https://shop/checkout",
    payment_link: "https://u.payu.in/x",
    payment_qr_url: "https://v3/qr",
    currency_code: "inr",
    total: 25200,
    item_count: 2,
    items: [],
  }

  it("shows the deposit due now, the balance and when, and says the link charges the deposit", () => {
    const out = render({
      ...base,
      deposit: {
        amount: 12600,
        deposit_pct: 50,
        balance_amount: 12600,
        balance_when: "when your order is ready — we'll email you a payment link",
      },
    })
    expect(out).toContain("Deposit due now &middot; 50%")
    expect(out).toContain("₹12,600.00")
    expect(out).toContain("Balance &mdash; due when your order is ready — we&#x27;ll email you a payment link")
    expect(out).toContain("PAY DEPOSIT &nbsp;→")
    expect(out).not.toContain("CHECKOUT &nbsp;→")
    expect(out).toContain("charge your <strong>deposit of ₹12,600.00</strong> only")
  })

  it("a fixed deposit shows no percentage", () => {
    const out = render({
      ...base,
      deposit: { amount: 800, deposit_pct: null, balance_amount: 24400, balance_when: "x" },
    })
    expect(out).toContain("Deposit due now\n</td>")
  })

  it("without a deposit it renders the old checkout wording and no deposit rows", () => {
    const out = render({ ...base, deposit: null })
    expect(out).toContain("CHECKOUT &nbsp;→")
    expect(out).not.toContain("Deposit due now")
    expect(out).not.toContain("PAY DEPOSIT")
    expect(out).toContain("Or open the payment link for the same amount:")
  })
})
