import { resolveDryRun } from "../validators"

/**
 * The MCP dispatcher owns `dry_run` and intercepts it before this route is
 * called, so `run_maintenance_job` could never reach a job's real change set:
 * `dry_run: true` returned a planned request and `dry_run: false` was a blind
 * write. `preview` is the spelling that survives the dispatcher.
 */
describe("resolveDryRun", () => {
  it("previews when nothing is asked for", () => {
    expect(resolveDryRun({})).toBe(true)
  })

  it("applies on an explicit preview:false — the MCP apply path", () => {
    expect(resolveDryRun({ preview: false })).toBe(false)
  })

  it("still applies on the legacy dry_run:false", () => {
    expect(resolveDryRun({ dry_run: false })).toBe(false)
  })

  it("previews on either spelling asking for one", () => {
    expect(resolveDryRun({ preview: true })).toBe(true)
    expect(resolveDryRun({ dry_run: true })).toBe(true)
  })

  /**
   * A contradictory body must resolve to the SAFE reading. Getting this
   * backwards turns a request that mentions a preview into a production write.
   */
  it("takes the safe reading when the two spellings disagree", () => {
    expect(resolveDryRun({ preview: false, dry_run: true })).toBe(true)
    expect(resolveDryRun({ preview: true, dry_run: false })).toBe(true)
  })

  it("agrees with itself when both say apply", () => {
    expect(resolveDryRun({ preview: false, dry_run: false })).toBe(false)
  })
})
