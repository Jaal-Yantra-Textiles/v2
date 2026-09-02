import {
  MIN_STALL_THRESHOLD_MS,
  STALL_INTERVAL_MULTIPLIER,
  folderExtractionLiveness,
  pendingFolderExtractionMedia,
} from "../folder-extraction-resume"

/**
 * #1742 — a run that stops writing has stopped, and nothing else can tell you.
 */
describe("folderExtractionLiveness", () => {
  const now = new Date("2026-09-02T08:00:00.000Z")
  const at = (iso: string) => ({
    status: "running",
    updated_at: iso,
    interval_ms: 60_000,
  })

  it("calls the production case stalled — 18/62, silent since 03:04", () => {
    const verdict = folderExtractionLiveness(at("2026-09-02T03:04:56.885Z"), now)

    expect(verdict.stalled).toBe(true)
    // Just under five hours of silence against a ten-minute threshold.
    expect(verdict.silent_for_ms).toBe(
      now.getTime() - Date.parse("2026-09-02T03:04:56.885Z")
    )
    expect(verdict.threshold_ms).toBe(MIN_STALL_THRESHOLD_MS)
  })

  it("leaves a run that wrote a moment ago alone", () => {
    expect(folderExtractionLiveness(at("2026-09-02T07:59:30.000Z"), now).stalled).toBe(
      false
    )
  })

  /**
   * 🔴 The floor is what stops a tight pacing from declaring a live run dead.
   * At 5 s intervals, three intervals is 15 s — one slow vision call.
   */
  it("never judges faster than the ten-minute floor, however tight the pacing", () => {
    const verdict = folderExtractionLiveness(
      { status: "running", updated_at: "2026-09-02T07:55:00.000Z", interval_ms: 5_000 },
      now
    )

    expect(verdict.threshold_ms).toBe(MIN_STALL_THRESHOLD_MS)
    expect(verdict.silent_for_ms).toBe(5 * 60 * 1000)
    expect(verdict.stalled).toBe(false)
  })

  it("scales the threshold with a slow pacing", () => {
    const interval = 15 * 60 * 1000
    const verdict = folderExtractionLiveness(
      { status: "running", updated_at: "2026-09-02T07:00:00.000Z", interval_ms: interval },
      now
    )

    // 45-minute threshold, 60 minutes of silence.
    expect(verdict.threshold_ms).toBe(interval * STALL_INTERVAL_MULTIPLIER)
    expect(verdict.silent_for_ms).toBe(60 * 60 * 1000)
    expect(verdict.stalled).toBe(true)
  })

  it("holds one interval short of the threshold", () => {
    const interval = 15 * 60 * 1000
    const verdict = folderExtractionLiveness(
      { status: "running", updated_at: "2026-09-02T07:30:00.000Z", interval_ms: interval },
      now
    )

    expect(verdict.threshold_ms).toBe(45 * 60 * 1000)
    expect(verdict.silent_for_ms).toBe(30 * 60 * 1000)
    expect(verdict.stalled).toBe(false)
  })

  /**
   * ⚠️ Only `running` can stall. Reporting a finished run as stalled would put
   * a Resume button on every folder ever extracted.
   */
  it.each(["completed", "failed"])("never calls a %s run stalled", (status) => {
    const verdict = folderExtractionLiveness(
      { status, updated_at: "2026-01-01T00:00:00.000Z", interval_ms: 60_000 },
      now
    )
    expect(verdict.stalled).toBe(false)
  })

  it("is not stalled when there is no progress at all", () => {
    expect(folderExtractionLiveness(null, now).stalled).toBe(false)
  })

  /**
   * A missing or unparseable timestamp is an absence of evidence. Treating it
   * as death would start a second loop over a folder that may still be live.
   */
  it.each([undefined, null, "", "not a date"])(
    "refuses to judge on updated_at=%p",
    (updated_at) => {
      const verdict = folderExtractionLiveness(
        { status: "running", updated_at: updated_at as any, interval_ms: 60_000 },
        now
      )
      expect(verdict.stalled).toBe(false)
      expect(verdict.silent_for_ms).toBeNull()
    }
  )
})

describe("pendingFolderExtractionMedia", () => {
  const image = (id: string) => ({
    id,
    file_type: "image",
    file_path: `https://cdn.example/${id}.jpg`,
  })

  const containerWith = (opts: {
    mediaFiles: any[]
    linkRows: any[]
    onGraph?: (args: any) => void
  }) => {
    const graph = jest.fn(async (args: any) => {
      opts.onGraph?.(args)
      return { data: opts.linkRows }
    })

    return {
      graph,
      container: {
        resolve: (key: string) => {
          if (key === "query") return { graph }
          return { listMediaFiles: jest.fn(async () => opts.mediaFiles) }
        },
      } as any,
    }
  }

  it("counts an image with an analysis as done and everything else as pending", async () => {
    const { container } = containerWith({
      mediaFiles: [image("m1"), image("m2"), image("m3")],
      linkRows: [{ media_file_id: "m2", textile_analysis_id: "ta_2" }],
    })

    const result = await pendingFolderExtractionMedia(container, "folder_1")

    expect(result.all_media_ids).toEqual(["m1", "m2", "m3"])
    expect(result.done_media_ids).toEqual(["m2"])
    expect(result.pending_media_ids).toEqual(["m1", "m3"])
  })

  /**
   * 🔴 The defect this whole change exists for. A file that FAILED and a file
   * the run never reached are indistinguishable to the work outstanding — the
   * old retry route could only see the first kind, so it offered to re-run 1 of
   * 44.
   */
  it("returns never-attempted images, not just ones that errored", async () => {
    const mediaFiles = Array.from({ length: 62 }, (_, i) => image(`m${i + 1}`))
    // 18 completed before the process was killed; m19 failed; m20..m62 untouched.
    const linkRows = mediaFiles
      .slice(0, 18)
      .map((m) => ({ media_file_id: m.id, textile_analysis_id: `ta_${m.id}` }))

    const { container } = containerWith({ mediaFiles, linkRows })

    const result = await pendingFolderExtractionMedia(container, "folder_1")

    expect(result.done_media_ids).toHaveLength(18)
    expect(result.pending_media_ids).toHaveLength(44)
    expect(result.pending_media_ids[0]).toBe("m19")
  })

  it("ignores non-images and media with no file_path", async () => {
    const { container } = containerWith({
      mediaFiles: [
        image("m1"),
        { id: "v1", file_type: "video", file_path: "https://cdn/v1.mp4" },
        { id: "m2", file_type: "image", file_path: null },
      ],
      linkRows: [],
    })

    const result = await pendingFolderExtractionMedia(container, "folder_1")

    expect(result.all_media_ids).toEqual(["m1"])
    expect(result.pending_media_ids).toEqual(["m1"])
  })

  /**
   * 🔴 Read through the LINK's entryPoint. Asking the media entity for a linked
   * field returns no key at all, silently — and every image would then look
   * pending, which here means re-billing the whole folder.
   */
  /**
   * ⚠️ This asserts the link's SHAPE, not its name. `defineLink().entryPoint`
   * is empty until the modules are registered, so a unit test comparing it to
   * a string would either fail or — worse — pass vacuously against `""`. The
   * name is pinned by the integration test, which runs a real container; what
   * is checkable here is that exactly one graph call is made, asking for the
   * link's own columns and filtered to this folder's media rather than
   * unfiltered.
   */
  it("makes one link query, asking for link columns filtered to this folder's media", async () => {
    const seen: any[] = []
    const { container } = containerWith({
      mediaFiles: [image("m1"), image("m2")],
      linkRows: [],
      onGraph: (args) => seen.push(args),
    })

    await pendingFolderExtractionMedia(container, "folder_1")

    expect(seen).toHaveLength(1)
    expect(seen[0].fields).toEqual(["media_file_id", "textile_analysis_id"])
    expect(seen[0].filters).toEqual({ media_file_id: ["m1", "m2"] })
  })

  it("does not query the link at all for an empty folder", async () => {
    const { container, graph } = containerWith({ mediaFiles: [], linkRows: [] })

    const result = await pendingFolderExtractionMedia(container, "folder_1")

    expect(result).toEqual({
      all_media_ids: [],
      pending_media_ids: [],
      done_media_ids: [],
    })
    expect(graph).not.toHaveBeenCalled()
  })

  /**
   * 🔴 Let the error out. Swallowing it reports every image as pending, and the
   * caller pays for a full re-extraction believing it is resuming.
   */
  it("throws rather than reporting everything as pending when the link fails", async () => {
    const container = {
      resolve: (key: string) => {
        if (key === "query") {
          return {
            graph: jest.fn(async () => {
              throw new Error("link unreachable")
            }),
          }
        }
        return { listMediaFiles: jest.fn(async () => [image("m1")]) }
      },
    } as any

    await expect(pendingFolderExtractionMedia(container, "folder_1")).rejects.toThrow(
      "link unreachable"
    )
  })
})
