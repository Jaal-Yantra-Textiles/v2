import { isAlreadyStored, platformMailboxes } from "../sync-imap-platforms"

describe("platformMailboxes (#2377 S1)", () => {
  it("reads the mailboxes list, trimmed and de-duplicated", () => {
    expect(platformMailboxes({ mailboxes: [" JYT_INBOUND_ORDERS", "CRM", "CRM", ""] })).toEqual([
      "JYT_INBOUND_ORDERS",
      "CRM",
    ])
  })

  it("accepts a comma-separated string", () => {
    expect(platformMailboxes({ mailboxes: "Orders, Partner" })).toEqual(["Orders", "Partner"])
  })

  it("falls back to the single mailbox of older rows, then INBOX", () => {
    expect(platformMailboxes({ mailbox: "JYT_INBOUND_ORDERS" })).toEqual(["JYT_INBOUND_ORDERS"])
    expect(platformMailboxes({})).toEqual(["INBOX"])
    expect(platformMailboxes({ mailboxes: [] })).toEqual(["INBOX"])
    expect(platformMailboxes(null)).toEqual(["INBOX"])
  })
})

describe("isAlreadyStored (#2377 S1)", () => {
  const email: any = { uid: 7, folder: "Orders", messageId: "<a@shop>" }

  const serviceWith = (rows: { byUid?: any[]; byMessageId?: any[] }) => ({
    listInboundEmails: jest.fn(async (filter: any) =>
      "imap_uid" in filter ? rows.byUid ?? [] : rows.byMessageId ?? []
    ),
  })

  it("skips the same uid in the folder for the same platform", async () => {
    const svc = serviceWith({ byUid: [{ metadata: { platform_id: "p1" } }] })
    expect(await isAlreadyStored(svc, email, "p1")).toBe(true)
  })

  it("does not treat another platform's uid as ours", async () => {
    const svc = serviceWith({ byUid: [{ metadata: { platform_id: "p2" } }] })
    expect(await isAlreadyStored(svc, email, "p1")).toBe(false)
  })

  it("skips a renumbered uid when the Message-ID is already in the folder", async () => {
    const svc = serviceWith({ byMessageId: [{ id: "ie_1" }] })
    expect(await isAlreadyStored(svc, email, "p1")).toBe(true)
  })

  it("stores an email with no Message-ID and an unseen uid", async () => {
    const svc = serviceWith({})
    expect(await isAlreadyStored(svc, { ...email, messageId: null }, "p1")).toBe(false)
    expect(svc.listInboundEmails).toHaveBeenCalledTimes(1)
  })
})
