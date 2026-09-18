import {
  PHOTO_BATCH_MAX_AGE_MS,
  PHOTO_BATCH_QUIET_MS,
  buildPhotoQuestionPurpose,
  decidePhotoBatchAction,
  isPhotoContextLive,
  recordPhoto,
  type PhotoBatch,
} from "../whatsapp-photo-batch"

const T = (iso: string) => new Date(iso)
const BASE = "2026-09-18T10:00:00.000Z"
const at = (secs: number) => new Date(Date.parse(BASE) + secs * 1000)

describe("recordPhoto", () => {
  it("starts a batch on the first photo", () => {
    const b = recordPhoto(null, "m1", T(BASE))
    expect(b.message_ids).toEqual(["m1"])
    expect(b.first_at).toBe(BASE)
    expect(b.last_at).toBe(BASE)
    expect(b.asked_at).toBeNull()
  })

  it("pushes last_at forward on each photo but keeps first_at", () => {
    let b = recordPhoto(null, "m1", at(0))
    b = recordPhoto(b, "m2", at(10))
    b = recordPhoto(b, "m3", at(25))
    expect(b.message_ids).toEqual(["m1", "m2", "m3"])
    expect(b.first_at).toBe(at(0).toISOString())
    expect(b.last_at).toBe(at(25).toISOString())
  })

  it("is idempotent on message id — a redelivered webhook is not a second photo", () => {
    // Meta re-delivers after a timeout. Counting one photo twice would make a
    // batch of one look like a burst.
    let b = recordPhoto(null, "m1", at(0))
    b = recordPhoto(b, "m1", at(5))
    expect(b.message_ids).toEqual(["m1"])
  })

  it("starts a FRESH batch once the previous one has been asked about", () => {
    const asked: PhotoBatch = {
      message_ids: ["m1", "m2"],
      first_at: at(0).toISOString(),
      last_at: at(10).toISOString(),
      asked_at: at(120).toISOString(),
    }
    const b = recordPhoto(asked, "m3", at(200))
    expect(b.message_ids).toEqual(["m3"])
    expect(b.asked_at).toBeNull()
  })
})

describe("decidePhotoBatchAction — the burst is ONE question", () => {
  it("waits while the partner is still sending", () => {
    let b = recordPhoto(null, "m1", at(0))
    b = recordPhoto(b, "m2", at(20))
    expect(decidePhotoBatchAction(b, at(40))).toEqual({
      action: "wait",
      reason: "still_sending",
      photos: 2,
    })
  })

  it("eight photos in thirty seconds is ONE question, not eight", () => {
    // The whole point. Asking per photo is worse than the guessing it replaces.
    let b: PhotoBatch | null = null
    for (let i = 0; i < 8; i++) {
      b = recordPhoto(b, `m${i}`, at(i * 4))
    }
    // Still uploading — silence.
    expect(decidePhotoBatchAction(b, at(30)).action).toBe("wait")

    // Quiet since the last one — one question about all eight.
    const d = decidePhotoBatchAction(b, at(28 + PHOTO_BATCH_QUIET_MS / 1000 + 1))
    expect(d).toEqual({ action: "ask", reason: "settled", photos: 8 })
  })

  it("measures the quiet window from the LAST photo, not the first", () => {
    // A partner still uploading at 90s has not finished. If the clock ran from
    // first_at we would interrupt them mid-burst.
    let b = recordPhoto(null, "m1", at(0))
    b = recordPhoto(b, "m2", at(85))
    expect(decidePhotoBatchAction(b, at(95)).action).toBe("wait")
    expect(decidePhotoBatchAction(b, at(85 + PHOTO_BATCH_QUIET_MS / 1000 + 1)).action).toBe("ask")
  })

  it("asks anyway once the batch hits its ceiling", () => {
    // One photo a minute forever would otherwise never settle.
    let b = recordPhoto(null, "m0", at(0))
    for (let i = 1; i <= 12; i++) b = recordPhoto(b, `m${i}`, at(i * 60))
    const d = decidePhotoBatchAction(b, at(12 * 60 + 1))
    expect(d.action).toBe("ask")
    expect((d as any).reason).toBe("max_age")
  })

  it("never asks twice about the same batch", () => {
    const b: PhotoBatch = {
      message_ids: ["m1"],
      first_at: at(0).toISOString(),
      last_at: at(0).toISOString(),
      asked_at: at(100).toISOString(),
    }
    expect(decidePhotoBatchAction(b, at(9999))).toEqual({
      action: "skip",
      reason: "already_asked",
    })
  })

  it("skips an empty or missing batch", () => {
    expect(decidePhotoBatchAction(null).reason).toBe("no_batch")
    expect(
      decidePhotoBatchAction({ message_ids: [], first_at: BASE, last_at: BASE }).reason
    ).toBe("no_batch")
  })

  it("asks rather than holds a batch it cannot date", () => {
    // The photos exist and the partner is waiting. Silence is the worse error.
    const b: PhotoBatch = {
      message_ids: ["m1"],
      first_at: "not-a-date",
      last_at: "not-a-date",
    }
    expect(decidePhotoBatchAction(b, at(10)).action).toBe("ask")
  })
})

describe("isPhotoContextLive", () => {
  const live = {
    kind: "inventory_offer",
    set_at: at(0).toISOString(),
    expires_at: at(3600).toISOString(),
  }

  it("is live before it expires and dead after", () => {
    expect(isPhotoContextLive(live, at(10))).toBe(true)
    expect(isPhotoContextLive(live, at(3601))).toBe(false)
  })

  it("treats a missing or unparseable expiry as EXPIRED, never as forever", () => {
    // 🔴 A context we cannot date is one we cannot trust, and acting on a stale
    // context is the failure that matters — same shape as #2122's stale slot.
    expect(isPhotoContextLive({ ...live, expires_at: "" } as any, at(10))).toBe(false)
    expect(isPhotoContextLive({ ...live, expires_at: "soon" } as any, at(10))).toBe(false)
    expect(isPhotoContextLive(null, at(10))).toBe(false)
    expect(isPhotoContextLive({ kind: "", set_at: "", expires_at: at(9999).toISOString() }, at(10))).toBe(false)
  })
})

describe("buildPhotoQuestionPurpose", () => {
  it("says how many, because one photo and eight are different questions", () => {
    expect(buildPhotoQuestionPurpose({ photos: 1 })).toContain("a photo")
    expect(buildPhotoQuestionPurpose({ photos: 8 })).toContain("8 photos")
  })

  it("offers open work as options WITHOUT asserting it is one of them", () => {
    const p = buildPhotoQuestionPurpose({
      photos: 3,
      openRunLabels: ["Alpha 60 Top", "Luong Shirt"],
    })
    expect(p).toContain("Alpha 60 Top")
    expect(p).toContain("do not assume it is one of them")
  })

  it("never tells the model the photos are a product", () => {
    // The entire defect being fixed: presupposing the subject.
    const p = buildPhotoQuestionPurpose({ photos: 2, openRunLabels: ["Some Run"] })
    expect(p).not.toMatch(/product/i)
  })

  it("stays sane with no open work", () => {
    const p = buildPhotoQuestionPurpose({ photos: 2 })
    expect(p).toContain("2 photos")
    expect(p).not.toContain("undefined")
  })
})
