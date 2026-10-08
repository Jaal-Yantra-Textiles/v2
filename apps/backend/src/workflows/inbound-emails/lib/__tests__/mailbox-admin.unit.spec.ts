import { mergeMailboxes } from "../mailbox-admin"

const box = (path: string, special_use: string | null = null, selectable = true) => ({
  path,
  name: path,
  special_use,
  selectable,
})

describe("mergeMailboxes (#2377 folder picker)", () => {
  it("marks the folders being read, Inbox first, ours A-Z, system last", () => {
    const rows = mergeMailboxes(
      [box("Sent Messages", "\\Sent"), box("JYT_INBOUND_ORDERS"), box("INBOX", "\\Inbox"), box("CRM")],
      ["JYT_INBOUND_ORDERS"]
    )
    expect(rows.map((r) => [r.path, r.reading])).toEqual([
      ["INBOX", false],
      ["CRM", false],
      ["JYT_INBOUND_ORDERS", true],
      ["Sent Messages", false],
    ])
  })

  it("leaves out containers that hold no mail", () => {
    expect(mergeMailboxes([box("Projects", null, false), box("CRM")], []).map((r) => r.path)).toEqual(["CRM"])
  })

  it("keeps a read folder that vanished from the account, flagged missing", () => {
    const rows = mergeMailboxes([box("CRM")], ["CRM", "Old Orders"])
    expect(rows.find((r) => r.path === "Old Orders")).toMatchObject({ reading: true, missing: true })
    expect(rows.find((r) => r.path === "CRM")?.missing).toBeUndefined()
  })
})
