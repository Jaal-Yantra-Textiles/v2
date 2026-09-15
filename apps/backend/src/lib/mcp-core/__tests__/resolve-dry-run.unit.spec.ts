import { resolveDryRun } from "../resolve-dry-run"

/**
 * The per-route DEFAULT is the whole reason this helper takes an argument, so
 * it is what these tests are mostly about. `run_maintenance_job` must preview
 * when asked for nothing; `POST /admin/products/bulk-update` must APPLY when
 * asked for nothing, because every caller it already has omits the flag and a
 * silent no-op is indistinguishable from a successful write.
 */
describe("resolveDryRun — shared preview/dry_run resolution (#1877)", () => {
  describe("preview-by-default surfaces (maintenance jobs)", () => {
    it("previews when neither spelling is given", () => {
      expect(resolveDryRun({})).toBe(true)
    })

    it("applies on an explicit preview:false", () => {
      expect(resolveDryRun({ preview: false })).toBe(false)
    })

    it("applies on the legacy dry_run:false", () => {
      expect(resolveDryRun({ dry_run: false })).toBe(false)
    })
  })

  describe("apply-by-default surfaces (products bulk-update)", () => {
    it("APPLIES when neither spelling is given — flipping this silently no-ops every existing caller", () => {
      expect(resolveDryRun({}, false)).toBe(false)
    })

    it("previews on preview:true, which is the only spelling that survives the dispatcher", () => {
      expect(resolveDryRun({ preview: true }, false)).toBe(true)
    })

    it("previews on dry_run:true too, so a direct HTTP caller still fails safe", () => {
      expect(resolveDryRun({ dry_run: true }, false)).toBe(true)
    })

    it("applies on an explicit preview:false", () => {
      expect(resolveDryRun({ preview: false }, false)).toBe(false)
    })
  })

  describe("the contradiction rule", () => {
    it("takes the SAFE reading when the two spellings disagree, on either default", () => {
      expect(resolveDryRun({ preview: false, dry_run: true })).toBe(true)
      expect(resolveDryRun({ preview: true, dry_run: false })).toBe(true)
      expect(resolveDryRun({ preview: false, dry_run: true }, false)).toBe(true)
      expect(resolveDryRun({ preview: true, dry_run: false }, false)).toBe(true)
    })

    it("does not let preview:false be swallowed by dry_run's default", () => {
      // The bug this rule exists for: `preview ?? dry_run ?? default` must
      // consult preview FIRST, or an explicit apply becomes unreachable.
      expect(resolveDryRun({ preview: false })).toBe(false)
      expect(resolveDryRun({ preview: false }, false)).toBe(false)
    })

    it("agrees with itself when both say apply", () => {
      expect(resolveDryRun({ preview: false, dry_run: false })).toBe(false)
      expect(resolveDryRun({ preview: false, dry_run: false }, false)).toBe(false)
    })
  })
})
