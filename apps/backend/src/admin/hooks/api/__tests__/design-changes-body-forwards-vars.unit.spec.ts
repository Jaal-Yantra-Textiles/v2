import fs from "fs";
import path from "path";

/**
 * #1953 — a key named in a mutation's `vars` type but absent from its `body`
 * literal is accepted by TypeScript and then silently dropped on the wire.
 *
 * `useChangeOrderDesigns` builds its request body as an explicit object
 * literal, not a spread:
 *
 *     body: { changes: vars.changes, notify: vars.notify, dry_run: vars.dry_run }
 *
 * So adding `production` to the `vars` type alone compiles, type-checks, and
 * sends nothing. The mutation resolves, the route applies its default
 * (`mode: "none"`), and production is simply never asked for — a success
 * response for work that was never requested. That is the same shape as the
 * `weight` field that made freight unquotable for a third of the catalogue,
 * and as `bulk_update_products` accepting a `prices` array and dropping it.
 *
 * This test reads the source and asserts every `vars` key is actually
 * forwarded, so the next field added to the type cannot go missing quietly.
 * It is deliberately source-analysis rather than a runtime mock: the defect is
 * a field that is never referenced, and a mock can only observe calls that
 * happen.
 */

const HOOK_FILE = path.join(__dirname, "..", "design-orders.ts");

/** Index of the `}` matching the `{` at `open`, skipping string contents. */
const matchBrace = (src: string, open: number): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
};

/**
 * Comments removed BEFORE any scanning.
 *
 * Learned the hard way writing this: an apostrophe in prose ("the route's
 * default") opens a quote state the brace/segment scanner never closes, and
 * every offset after it is wrong. A docblock is not code and must not be
 * parsed as if it were.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * The source of one exported hook — from its declaration to the next
 * `export const`, so sibling hooks in the same file cannot satisfy an
 * assertion about this one.
 */
const hookSource = (src: string, name: string): string => {
  const start = src.indexOf(`export const ${name} =`);
  if (start === -1) {
    throw new Error(`hook "${name}" not found — was it renamed?`);
  }
  const next = src.indexOf("\nexport const ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
};

/** Top-level property names of the `vars: { ... }` parameter type. */
const varsKeys = (hookSrc: string): string[] => {
  const marker = "(vars: {";
  const at = hookSrc.indexOf(marker);
  if (at === -1) {
    throw new Error("no `(vars: {` parameter found in hook source");
  }
  const open = at + marker.length - 1;
  const close = matchBrace(hookSrc, open);
  const body = hookSrc.slice(open + 1, close);

  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let lineStart = 0;
  const lines: string[] = [];
  // Split on top-level `;` / newline boundaries, ignoring nested objects so
  // that `production: { mode?: ... }` contributes `production`, not `mode`.
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if ((c === ";" || c === "\n") && depth === 0) {
      lines.push(body.slice(lineStart, i));
      lineStart = i + 1;
    }
  }
  lines.push(body.slice(lineStart));

  for (const raw of lines) {
    // Input is already comment-free (see stripComments).
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
};

describe("useChangeOrderDesigns — every vars key reaches the request", () => {
  const src = fs.readFileSync(HOOK_FILE, "utf8");
  const hook = stripComments(hookSource(src, "useChangeOrderDesigns"));

  /**
   * `order_id` is interpolated into the URL, not sent in the body, so it is
   * forwarded by `vars.order_id` appearing in the path template — which the
   * reference check below covers without needing an exception for where.
   */
  it("references every declared vars key as `vars.<key>`", () => {
    const keys = varsKeys(hook);

    // Guard the parser itself: if it silently returned [] this suite would
    // pass while asserting nothing.
    expect(keys).toContain("changes");
    expect(keys).toContain("order_id");
    expect(keys.length).toBeGreaterThanOrEqual(4);

    const missing = keys.filter((k) => !hook.includes(`vars.${k}`));
    expect(missing).toEqual([]);
  });

  it("forwards `production` in the body literal, not just in the type", () => {
    // The specific key #1953 needs. Named explicitly so a rename of the
    // generic check above cannot quietly stop covering it.
    expect(varsKeys(hook)).toContain("production");
    expect(hook).toMatch(/production:\s*vars\.production/);
  });

  it("still forwards the keys that were already working", () => {
    expect(hook).toMatch(/changes:\s*vars\.changes/);
    expect(hook).toMatch(/notify:\s*vars\.notify/);
    expect(hook).toMatch(/dry_run:\s*vars\.dry_run/);
  });
});
