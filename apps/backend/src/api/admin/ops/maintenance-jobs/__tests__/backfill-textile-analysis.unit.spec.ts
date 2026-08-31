import { backfillTextileAnalysisJob } from "../backfill-textile-analysis-job"

/**
 * #1697 — move `metadata.textile_extraction` into typed `textile_analysis` rows.
 *
 * The job shipped with no test of its own and a single 1000-row read. Production
 * holds **1671** media files, so the sweep never opened 671 of them and reported
 * "3 of 3 candidates" while **37** carried the blob — a silent truncation that
 * reads exactly like a finished job.
 *
 * These run against a fake container that PAGES the way the real service does,
 * so the assertion is about what the sweep reaches, not about what it decides
 * once it gets there.
 */

type File = Record<string, any>

const blob = (over: Record<string, any> = {}) => ({
  cloth_type: "Saree",
  pattern: "floral",
  fabric_weight: "light",
  primary_color: "indigo",
  title: "Indigo Floral Saree",
  description: "A handwoven indigo saree.",
  ...over,
})

const file = (i: number, over: Partial<File> = {}): File => ({
  // ids sort the way the sweep orders them
  id: `media_${String(i).padStart(5, "0")}`,
  title: null,
  description: null,
  alt_text: null,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  metadata: {},
  ...over,
})

const makeContainer = (files: File[], opts: { linkedIds?: string[] } = {}) => {
  const listMediaFiles = jest.fn(async (filters: any, config: any = {}) => {
    const pool = filters?.id
      ? files.filter((f) => f.id === filters.id)
      : [...files].sort((a, b) => (a.id < b.id ? -1 : 1))
    const skip = config.skip ?? 0
    const take = config.take ?? pool.length
    return pool.slice(skip, skip + take)
  })
  const updateMediaFiles = jest.fn().mockResolvedValue(undefined)
  const createTextileAnalyses = jest.fn(async (row: any) => ({
    id: `ta_${row.title ?? "x"}`,
    ...row,
  }))
  const linkCreate = jest.fn().mockResolvedValue(undefined)
  const graph = jest.fn(async () => ({
    data: (opts.linkedIds ?? []).map((id) => ({
      media_file_id: id,
      textile_analysis_id: `ta_existing_${id}`,
    })),
  }))

  return {
    listMediaFiles,
    updateMediaFiles,
    createTextileAnalyses,
    linkCreate,
    graph,
    container: {
      resolve: (key: string) => {
        if (key === "media") return { listMediaFiles, updateMediaFiles }
        if (key === "textile_analysis") return { createTextileAnalyses }
        if (key === "query") return { graph }
        if (key === "link") return { create: linkCreate }
        throw new Error(`unexpected resolve(${key})`)
      },
    } as any,
  }
}

describe("backfill-textile-analysis (#1697)", () => {
  it("reaches a blob past the first page — the truncation that hid 34 of 37", async () => {
    // 1671 files, as production has, with the blobs sitting beyond one page.
    const files = Array.from({ length: 1671 }, (_, i) =>
      i >= 1200 && i < 1234 ? file(i, { metadata: { textile_extraction: blob() } }) : file(i)
    )
    const { container } = makeContainer(files)

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: true,
      params: {},
    } as any)

    expect(res.changes).toHaveLength(34)
    expect(res.summary).toContain("1671 file(s) scanned")
  })

  it("says how many files it scanned, so a short sweep is visible", async () => {
    const files = Array.from({ length: 30 }, (_, i) =>
      i === 0 ? file(i, { metadata: { textile_extraction: blob() } }) : file(i)
    )
    const { container } = makeContainer(files)

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: true,
      params: {},
    } as any)

    expect(res.summary).toContain("30 file(s) scanned")
  })

  it("writes the row, the link and only the EMPTY media columns", async () => {
    const files = [
      file(1, {
        metadata: { textile_extraction: blob() },
        title: "An operator's own title",
      }),
    ]
    const { container, createTextileAnalyses, linkCreate, updateMediaFiles } =
      makeContainer(files)

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(res.applied).toBe(true)
    expect(createTextileAnalyses).toHaveBeenCalledTimes(1)
    expect(createTextileAnalyses.mock.calls[0][0]).toMatchObject({
      source: "internal_extraction",
      cloth_type: "saree",
      pattern: "floral",
    })
    expect(linkCreate).toHaveBeenCalledTimes(1)

    // the human-written title survives; the empty columns get filled
    const mirror = updateMediaFiles.mock.calls[0][0]
    expect(mirror.title).toBeUndefined()
    expect(mirror.description).toBe("A handwoven indigo saree.")
    expect(mirror.alt_text).toBe("A handwoven indigo saree.")
  })

  it("skips a media file that already has an analysis linked", async () => {
    const files = [file(1, { metadata: { textile_extraction: blob() } })]
    const { container, createTextileAnalyses } = makeContainer(files, {
      linkedIds: ["media_00001"],
    })

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(createTextileAnalyses).not.toHaveBeenCalled()
    expect(res.changes[0]).toMatchObject({ after: "skipped" })
  })

  it("limit caps the CANDIDATES processed, not the files looked at", async () => {
    const files = Array.from({ length: 1200 }, (_, i) =>
      i % 100 === 0 ? file(i, { metadata: { textile_extraction: blob() } }) : file(i)
    )
    const { container } = makeContainer(files)

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: true,
      params: { limit: 4 },
    } as any)

    expect(res.changes).toHaveLength(4)
  })

  it("media_id reads that one file only", async () => {
    const files = Array.from({ length: 50 }, (_, i) =>
      file(i, { metadata: { textile_extraction: blob() } })
    )
    const { container, listMediaFiles } = makeContainer(files)

    const res = await backfillTextileAnalysisJob.run(container, {
      dry_run: true,
      params: { media_id: "media_00007" },
    } as any)

    expect(listMediaFiles).toHaveBeenCalledTimes(1)
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0].id).toBe("media_00007")
  })
})
