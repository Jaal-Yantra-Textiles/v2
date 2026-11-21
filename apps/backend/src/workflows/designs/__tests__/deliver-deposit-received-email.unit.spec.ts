const run = jest.fn()
jest.mock("../../email/workflows/send-notification-email", () => ({
  sendNotificationEmailWorkflow: () => ({ run: (...a: any[]) => run(...a) }),
}))

import { deliverDepositReceivedEmail } from "../deliver-deposit-received-email"

const containerWith = (order: any) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    logger,
    resolve: (k: string) =>
      k === "logger" ? logger : { graph: jest.fn(async () => ({ data: order ? [order] : [] })) },
  }
}

beforeEach(() => {
  run.mockReset()
  run.mockResolvedValue({ result: { id: "msg_1" } })
})

describe("deliverDepositReceivedEmail", () => {
  const input = { orderId: "order_1", depositAmount: 8085, total: 11550, balanceAmount: 3465 }

  it("sends the three figures to the order's email", async () => {
    const c = containerWith({ id: "order_1", display_id: 150, email: "b@x.com", currency_code: "inr" })
    const out = await deliverDepositReceivedEmail(c, input)
    expect(out.sent).toBe(true)
    const [{ input: sent }] = run.mock.calls[0]
    expect(sent.to).toBe("b@x.com")
    expect(sent.template).toBe("design-order-deposit-received")
    expect(sent.data).toEqual(
      expect.objectContaining({ deposit_amount: 8085, total: 11550, balance_amount: 3465, display_id: 150 })
    )
  })

  it("sends nothing when nothing is outstanding (a full prepaid convert)", async () => {
    const c = containerWith({ id: "order_1", email: "b@x.com" })
    const out = await deliverDepositReceivedEmail(c, { ...input, balanceAmount: 0 })
    expect(out.sent).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it("never throws — a missing template is logged, not raised", async () => {
    run.mockRejectedValue(new Error("Template design-order-deposit-received not found"))
    const c = containerWith({ id: "order_1", email: "b@x.com", currency_code: "inr" })
    const out = await deliverDepositReceivedEmail(c, input)
    expect(out.sent).toBe(false)
    expect(c.logger.error).toHaveBeenCalledWith(expect.stringContaining("NOT sent"))
  })
})
