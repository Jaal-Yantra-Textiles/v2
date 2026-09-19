import {
  buildMediaAckText,
  decideMediaAckAction,
  MEDIA_ACK_MAX_AGE_MS,
  MEDIA_ACK_QUIET_MS,
  recordMediaAck,
  type MediaAckBatch,
} from "../whatsapp-media-ack-batch"

const at = (iso: string) => new Date(iso)
const T0 = "2026-09-19T10:00:00.000Z"

describe("recordMediaAck", () => {
  it("starts a burst from nothing", () => {
    const b = recordMediaAck(null, "m1", { kind: "shared_folder", label: "GOF" }, at(T0))
    expect(b.message_ids).toEqual(["m1"])
    expect(b.entries).toEqual([{ kind: "shared_folder", label: "GOF" }])
    expect(b.first_at).toBe(T0)
    expect(b.last_at).toBe(T0)
    expect(b.acked_at).toBeNull()
  })

  it("a second file resets last_at but never first_at", () => {
    const one = recordMediaAck(null, "m1", { kind: "shared_folder", label: "GOF" }, at(T0))
    const two = recordMediaAck(
      one,
      "m2",
      { kind: "shared_folder", label: "GOF" },
      at("2026-09-19T10:00:09.000Z")
    )
    expect(two.message_ids).toEqual(["m1", "m2"])
    expect(two.first_at).toBe(T0)
    expect(two.last_at).toBe("2026-09-19T10:00:09.000Z")
  })

  /**
   * Meta re-delivers a webhook when our response is slow. Counting one file
   * twice tells the partner we received 13 swatches when they sent 12 — a
   * number they can check us on.
   */
  it("is idempotent on message id — a redelivery does not inflate the count", () => {
    const one = recordMediaAck(null, "m1", { kind: "shared_folder", label: "GOF" }, at(T0))
    const again = recordMediaAck(
      one,
      "m1",
      { kind: "shared_folder", label: "GOF" },
      at("2026-09-19T10:00:05.000Z")
    )
    expect(again.message_ids).toEqual(["m1"])
    expect(again.entries).toHaveLength(1)
  })

  it("keeps entries index-aligned with message_ids on the redelivery path", () => {
    let b = recordMediaAck(null, "m1", { kind: "run", label: "run_1" }, at(T0))
    b = recordMediaAck(b, "m1", { kind: "run", label: "run_1" }, at(T0))
    b = recordMediaAck(b, "m2", { kind: "shared_folder", label: "GOF" }, at(T0))
    expect(b.message_ids).toHaveLength(b.entries.length)
    expect(b.entries[1]).toEqual({ kind: "shared_folder", label: "GOF" })
  })

  it("files sent AFTER an acknowledgement start a fresh burst", () => {
    const acked: MediaAckBatch = {
      message_ids: ["m1", "m2"],
      entries: [
        { kind: "shared_folder", label: "GOF" },
        { kind: "shared_folder", label: "GOF" },
      ],
      first_at: T0,
      last_at: T0,
      acked_at: T0,
    }
    const next = recordMediaAck(acked, "m3", { kind: "shared_folder", label: "GOF" })
    expect(next.message_ids).toEqual(["m3"])
    expect(next.acked_at).toBeNull()
  })
})

describe("decideMediaAckAction", () => {
  const burst = (last: string, first = T0): MediaAckBatch => ({
    message_ids: ["m1", "m2"],
    entries: [
      { kind: "shared_folder", label: "GOF" },
      { kind: "shared_folder", label: "GOF" },
    ],
    first_at: first,
    last_at: last,
    acked_at: null,
  })

  it("waits while the partner is still sending", () => {
    const now = new Date(Date.parse(T0) + MEDIA_ACK_QUIET_MS - 1_000)
    expect(decideMediaAckAction(burst(T0), now)).toEqual({
      action: "wait",
      reason: "still_sending",
      files: 2,
    })
  })

  it("acknowledges once the burst has settled", () => {
    const now = new Date(Date.parse(T0) + MEDIA_ACK_QUIET_MS)
    expect(decideMediaAckAction(burst(T0), now)).toEqual({
      action: "ack",
      reason: "settled",
      files: 2,
    })
  })

  /**
   * 🔴 The quiet window runs from the LAST file. A partner still uploading has
   * not finished, and measuring from the first would fire mid-burst — which is
   * the per-file spam this replaces, just with fewer messages.
   */
  it("measures the quiet window from the LAST file, not the first", () => {
    const first = T0
    const last = new Date(Date.parse(T0) + 60_000).toISOString()
    const now = new Date(Date.parse(last) + MEDIA_ACK_QUIET_MS - 5_000)
    expect(decideMediaAckAction(burst(last, first), now).action).toBe("wait")
  })

  it("a trickle is acknowledged anyway once the ceiling is reached", () => {
    const first = T0
    // Still "active" — a file 5s ago — but the burst opened long ago.
    const now = new Date(Date.parse(T0) + MEDIA_ACK_MAX_AGE_MS + 1_000)
    const last = new Date(now.getTime() - 5_000).toISOString()
    expect(decideMediaAckAction(burst(last, first), now)).toEqual({
      action: "ack",
      reason: "max_age",
      files: 2,
    })
  })

  it("never acknowledges twice", () => {
    const b = { ...burst(T0), acked_at: T0 }
    expect(decideMediaAckAction(b, new Date(Date.parse(T0) + 600_000))).toEqual({
      action: "skip",
      reason: "already_acked",
    })
  })

  it("an empty or missing batch is skipped, not acknowledged", () => {
    expect(decideMediaAckAction(null).action).toBe("skip")
    expect(decideMediaAckAction({ ...burst(T0), message_ids: [] }).action).toBe("skip")
  })

  it("an undateable batch is acknowledged rather than held forever", () => {
    expect(decideMediaAckAction({ ...burst(T0), last_at: "not-a-date" }).action).toBe("ack")
  })
})

describe("buildMediaAckText", () => {
  const b = (entries: MediaAckBatch["entries"]): MediaAckBatch => ({
    message_ids: entries.map((_, i) => `m${i}`),
    entries,
    first_at: T0,
    last_at: T0,
    acked_at: null,
  })

  /**
   * The count is the only part of this message the partner can check us on. A
   * partner who sent twelve files and is told "received your file" cannot tell
   * whether the other eleven arrived.
   */
  it("names the count — Rahul's twelve swatches", () => {
    const text = buildMediaAckText(
      b(Array.from({ length: 12 }, () => ({ kind: "shared_folder" as const, label: "GOF" })))
    )
    expect(text).toContain("12 files")
    expect(text).toContain("*GOF*")
  })

  it("says 1 file, not 1 files", () => {
    expect(buildMediaAckText(b([{ kind: "shared_folder", label: "GOF" }]))).toContain("1 file")
    expect(buildMediaAckText(b([{ kind: "shared_folder", label: "GOF" }]))).not.toContain("1 files")
  })

  it("does not repeat one destination once per file", () => {
    const text = buildMediaAckText(
      b([
        { kind: "shared_folder", label: "GOF" },
        { kind: "shared_folder", label: "GOF" },
        { kind: "shared_folder", label: "GOF" },
      ])
    )
    expect(text.match(/GOF/g)).toHaveLength(1)
  })

  /**
   * One burst can legitimately contain more than one destination — two run
   * photos and a fabric picture in the same thirty seconds. Flattening that
   * into one sentence would make it false.
   */
  it("describes a mixed burst by destination", () => {
    const text = buildMediaAckText(
      b([
        { kind: "run", label: "run_1" },
        { kind: "run", label: "run_1" },
        { kind: "shared_folder", label: "GOF" },
      ])
    )
    expect(text).toContain("3 files")
    expect(text).toContain("run run_1")
    expect(text).toContain("*GOF*")
  })

  it("appends an admin's context confirmation verbatim", () => {
    const text = buildMediaAckText(
      b([{ kind: "context", label: "Noted — these are the lot you're offering us." }])
    )
    expect(text).toContain("Noted — these are the lot you're offering us.")
  })

  it("survives a burst with no labels at all", () => {
    const text = buildMediaAckText(b([{ kind: "shared_folder", label: null }]))
    expect(text).toBe("✅ Got 1 file.")
  })
})
