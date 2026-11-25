/**
 * #2625 S2 — notes on the Pending work board, over HTTP.
 *
 * The contract the founder and the MCP tools lean on: a note gets a quotable
 * N-<ref>, "N-12" finds it, closing it takes it off the board's open list, and
 * the board's notes box counts it.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeAll(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  it("adds a note with a reference, finds it by N-ref, closes it off the board", async () => {
    const created = await api.post(
      "/admin/work-notes",
      { body: "Ask Sreeni for measurements", due_at: "2026-11-20", kind: "follow_up", node_key: "balances-due" },
      headers
    )
    expect(created.status).toBe(201)
    const note = created.data.work_note
    expect(note.reference).toMatch(/^N-\d+$/)
    expect(note.status).toBe("open")

    const byRef = await api.get(`/admin/work-notes/${note.reference}`, headers)
    expect(byRef.data.work_note.id).toBe(note.id)

    const board = await api.get("/admin/graph/queue/pending-work", headers)
    const box = board.data.graph.nodes.find((n: any) => n.key === "notes")
    expect(box.count).toBeGreaterThanOrEqual(1)
    const balances = board.data.graph.nodes.find((n: any) => n.key === "balances-due")
    expect(balances.sublabel).toMatch(/note/)

    const closed = await api.post(`/admin/work-notes/${note.reference}`, { status: "done" }, headers)
    expect(closed.data.work_note.status).toBe("done")
    expect(closed.data.work_note.done_at).toBeTruthy()

    const open = await api.get("/admin/work-notes", headers)
    expect(open.data.work_notes.map((n: any) => n.id)).not.toContain(note.id)
    const all = await api.get("/admin/work-notes?status=all", headers)
    expect(all.data.work_notes.map((n: any) => n.id)).toContain(note.id)

    const reopened = await api.post(`/admin/work-notes/${note.id}`, { status: "open" }, headers)
    expect(reopened.data.work_note.done_at).toBeNull()
  })

  it("refuses an empty note and an unreadable reference", async () => {
    await expect(api.post("/admin/work-notes", { body: "  " }, headers)).rejects.toMatchObject({
      response: { status: 400 },
    })
    await expect(api.get("/admin/work-notes/N-twelve", headers)).rejects.toMatchObject({
      response: { status: 400 },
    })
    await expect(api.get("/admin/work-notes/N-999999", headers)).rejects.toMatchObject({
      response: { status: 404 },
    })
  })
})
