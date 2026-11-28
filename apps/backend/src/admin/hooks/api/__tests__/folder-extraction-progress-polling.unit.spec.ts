jest.mock("@medusajs/ui", () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock("../../../lib/config", () => ({ sdk: {} }))
jest.mock("../media-folders/use-media-folder-detail", () => ({ mediaFolderDetailQueryKeys: { all: ["media-folder"] } }))
jest.mock("@tanstack/react-query", () => ({ useMutation: jest.fn(), useQuery: jest.fn(), useQueryClient: jest.fn() }))

import { folderExtractionRefetchInterval, markFolderExtractionStarted } from "../textile-extraction"

/**
 * 2026-11-28: the founder started "Extract Features of All Media" on a folder
 * and no progress bar appeared. The status query had run once on page load (no
 * run → no progress), its interval only polls while it sees "running", and the
 * workflow writes "running" just AFTER the confirm returns — so nothing ever
 * asked again until a reload. After a confirm, poll until the run shows up.
 */
const q = (data: any) => ({ state: { data } })

describe("folder extraction status polling", () => {
  it("polls every 5 s while a run is live, stops when stalled or finished", () => {
    const rule = folderExtractionRefetchInterval("fold_idle")
    expect(rule(q({ progress: { status: "running" }, stalled: false }))).toBe(5000)
    expect(rule(q({ progress: { status: "running" }, stalled: true }))).toBe(false)
    expect(rule(q({ progress: { status: "completed" } }))).toBe(false)
  })

  it("with no run yet, does NOT poll — unless this tab just confirmed one", () => {
    expect(folderExtractionRefetchInterval("fold_a")(q({ progress: null }))).toBe(false)
    markFolderExtractionStarted("fold_a")
    expect(folderExtractionRefetchInterval("fold_a")(q({ progress: null }))).toBe(3000)
    // only for that folder
    expect(folderExtractionRefetchInterval("fold_b")(q({ progress: null }))).toBe(false)
  })

  it("the warm-up ends after a minute", () => {
    const now = Date.now()
    const spy = jest.spyOn(Date, "now").mockReturnValue(now)
    markFolderExtractionStarted("fold_c")
    spy.mockReturnValue(now + 61_000)
    expect(folderExtractionRefetchInterval("fold_c")(q({ progress: null }))).toBe(false)
    spy.mockRestore()
  })
})
