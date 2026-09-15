/**
 * `preview` vs `dry_run` — one resolution, shared by every route the admin MCP
 * surface can reach.
 *
 * WHY THE ALIAS EXISTS (#1877)
 * ----------------------------
 * `dry_run` is the DISPATCHER's own flag. `mcp-core/dispatch.ts` reads
 * `args.dry_run` and returns the planned HTTP request without ever calling the
 * route, so a tool whose route computes a real change set can never deliver it:
 *
 *   dry_run: true   → a plan echo, never the route's change set
 *   dry_run: false  → a blind write on production
 *
 * `preview` is not in the dispatcher's `CONTROL_ARGS`, so it is forwarded like
 * any other body field and reaches the route. A tool that wants a genuine
 * rehearsal must therefore advertise `preview` and resolve it HERE.
 *
 * THE DEFAULT IS PER-ROUTE, AND IT MATTERS
 * ----------------------------------------
 * `run_maintenance_job` is preview-by-default: omitting the flag must not
 * mutate production. `POST /admin/products/bulk-update` is apply-by-default and
 * has been since it shipped — flipping it would silently turn every existing
 * caller's write into a no-op, which is a worse failure than the one this fixes
 * (it looks exactly like success). So the caller states its own default rather
 * than inheriting a shared one.
 *
 * THE CONTRADICTION RULE
 * ----------------------
 * Either flag explicitly `true` wins, so `{preview: false, dry_run: true}`
 * reads as a preview and never as a write. Below that, `preview` is consulted
 * before `dry_run` so an explicit `preview: false` is NOT swallowed by
 * `dry_run`'s default — that swallowing is a real bug that once made APPLY
 * impossible, and it is why this cannot collapse to `a || b`.
 */
export function resolveDryRun(
  body: { preview?: boolean; dry_run?: boolean },
  defaultDryRun = true
): boolean {
  if (body.preview === true || body.dry_run === true) return true
  return body.preview ?? body.dry_run ?? defaultDryRun
}
