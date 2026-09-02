import resumeStalledFolderExtractions, {
  MAX_RESUME_ATTEMPTS,
  config,
} from "../resume-stalled-folder-extractions"

/**
 * #1742 — the sweeper that finishes what a deploy interrupted.
 *
 * The production case: 62 images, 18 done, killed at 03:04 by the ECS task
 * replacement that a deploy performs, still claiming `status: "running"` five
 * hours later with nothing alive to change its mind. At the measured pace —
 * ~3.2 min per photo — a full folder is a 3.3-hour run inside one Node process,
 * and there were six deploys that day. Nobody was ever going to be watching.
 *
 * These tests pin the three properties that decide whether the sweep is safe to
 * leave running unattended: it must fire on its own, it must never touch a run
 * that is alive, and it must give up rather than burn vision calls forever.
 */

const mockRun = jest.fn()
const mockSetStepSuccess = jest.fn()
const mockPending = jest.fn()

jest.mock("../../workflows/ai/textile-folder-extraction", () => ({
  textileFolderExtractionMedusaWorkflow: () => ({ run: mockRun }),
  textileFolderExtractionWorkflowId: "textile-folder-extraction",
  waitConfirmationTextileFolderExtractionStepId: "wait-confirmation",
}))

jest.mock("../../workflows/ai/lib/folder-extraction-resume", () => {
  const actual = jest.requireActual("../../workflows/ai/lib/folder-extraction-resume")
  return {
    ...actual,
    pendingFolderExtractionMedia: (...args: any[]) => mockPending(...args),
  }
})

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const folderWith = (over: Record<string, any> = {}, id = "folder_1") => ({
  id,
  name: `Folder ${id}`,
  metadata: {
    folder_extraction: {
      status: "running",
      total: 62,
      completed: 18,
      failed: 1,
      interval_ms: 60_000,
      updated_at: minutesAgo(300),
      ...over,
    },
  },
})

const containerWith = (folders: any[]) => {
  const log = logger()
  const mediaService = {
    listFolders: jest.fn(async () => folders),
    updateFolders: jest.fn(async () => undefined),
  }

  return {
    log,
    mediaService,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return log
        if (key === "media") return mediaService
        if (key === "workflows") return { setStepSuccess: mockSetStepSuccess }
        throw new Error(`unexpected resolve(${key})`)
      },
    } as any,
  }
}

describe("resume-stalled-folder-extractions", () => {
  beforeEach(() => {
    mockRun.mockReset()
    mockRun.mockResolvedValue({ transaction: { transactionId: "tx_1" } })
    mockSetStepSuccess.mockReset()
    mockSetStepSuccess.mockResolvedValue(undefined)
    mockPending.mockReset()
    mockPending.mockResolvedValue({
      all_media_ids: Array.from({ length: 62 }, (_, i) => `m${i + 1}`),
      pending_media_ids: Array.from({ length: 44 }, (_, i) => `m${i + 19}`),
      done_media_ids: Array.from({ length: 18 }, (_, i) => `m${i + 1}`),
    })
  })

  it("is scheduled — a run this long cannot rely on someone watching it", () => {
    expect(config.name).toBe("resume-stalled-folder-extractions")
    expect(config.schedule).toBe("*/30 * * * *")
  })

  /**
   * 🔑 The production shape, end to end: silent for five hours, 44 outstanding,
   * resumed as a `pending`-scoped run over exactly those 44.
   */
  it("resumes a stalled folder over exactly the outstanding images", async () => {
    const { container } = containerWith([folderWith()])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).toHaveBeenCalledTimes(1)
    const input = mockRun.mock.calls[0][0].input
    expect(input.folder_id).toBe("folder_1")
    expect(input.scope).toBe("pending")
    expect(input.media_ids).toHaveLength(44)
    expect(input.persist).toBe(true)
    // The pacing the run was started with is kept, not reset to the default.
    expect(input.interval_ms).toBe(60_000)

    // Auto-confirmed, or it would sit at the wait step forever.
    expect(mockSetStepSuccess).toHaveBeenCalledTimes(1)
  })

  /**
   * 🔴 The one that matters most. Two loops over one folder would extract every
   * pending image twice, in parallel, at double the provider rate the pacing
   * exists to respect — and `link.create` is not idempotent, so each leaves its
   * own duplicate analysis row.
   */
  it("never touches a run that is still writing progress", async () => {
    const { container } = containerWith([folderWith({ updated_at: minutesAgo(1) })])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).not.toHaveBeenCalled()
  })

  it.each(["completed", "failed"])("ignores a %s run", async (status) => {
    const { container } = containerWith([
      folderWith({ status, updated_at: minutesAgo(5000) }),
    ])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).not.toHaveBeenCalled()
  })

  it("ignores folders that have never been extracted", async () => {
    const { container } = containerWith([{ id: "f", name: "f", metadata: {} }])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).not.toHaveBeenCalled()
  })

  /**
   * 🔴 A folder whose images fail for a reason that will not change must stop
   * costing vision calls and be left for a human — the same rule
   * `process-email-queue` applies with `MAX_ATTEMPTS`.
   */
  it("gives up after the attempt cap and says so", async () => {
    const { container, log } = containerWith([
      folderWith({ resume_attempts: MAX_RESUME_ATTEMPTS }),
    ])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("leaving it for a human"))
  })

  it("still resumes one attempt short of the cap", async () => {
    const { container } = containerWith([
      folderWith({ resume_attempts: MAX_RESUME_ATTEMPTS - 1 }),
    ])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  /**
   * The run died after its last photo but before `finalizeFolderExtractionStep`.
   * There is nothing to extract — but leaving it `running` means the admin strip
   * spins forever and every future sweep finds it again.
   */
  it("closes a folder that is actually complete instead of re-running it", async () => {
    mockPending.mockResolvedValue({
      all_media_ids: ["m1", "m2"],
      pending_media_ids: [],
      done_media_ids: ["m1", "m2"],
    })
    const { container, mediaService } = containerWith([folderWith()])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).not.toHaveBeenCalled()
    const write = (mediaService.updateFolders as jest.Mock).mock.calls[0]?.[0] as any
    expect(write?.data?.metadata?.folder_extraction?.status).toBe("completed")
    expect(write?.data?.metadata?.folder_extraction?.finished_at).toBeTruthy()
  })

  /**
   * 🔑 A cap that trims the list silently reads as "everything was handled" on
   * the next pass.
   */
  it("caps how many folders it resumes in one pass, and names what it left", async () => {
    const stalled = Array.from({ length: 8 }, (_, i) => folderWith({}, `folder_${i}`))
    const { container, log } = containerWith(stalled)

    await resumeStalledFolderExtractions(container)

    expect(mockRun).toHaveBeenCalledTimes(5)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("left for the next run"))
  })

  it("keeps going when one folder fails to resume", async () => {
    mockRun
      .mockRejectedValueOnce(new Error("engine unavailable"))
      .mockResolvedValue({ transaction: { transactionId: "tx_2" } })

    const { container, log } = containerWith([
      folderWith({}, "folder_a"),
      folderWith({}, "folder_b"),
    ])

    await resumeStalledFolderExtractions(container)

    expect(mockRun).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("folder_a"))
  })
})
