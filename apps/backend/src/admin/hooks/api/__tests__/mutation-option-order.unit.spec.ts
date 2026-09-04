import fs from "fs";
import path from "path";

/**
 * #1800 — `...options` spread AFTER `onSuccess` silently drops cache invalidation.
 *
 * `useMutation` takes a plain object, so the last key wins. With the spread
 * last, any caller that passes its own `onSuccess` — to toast, to navigate, to
 * close a modal — REPLACES the hook's handler, and `invalidateQueries` never
 * runs. Nothing errors: the save succeeds, the modal closes, and the screen
 * keeps showing the stale row until a hard refresh.
 *
 * The spread must come first, so the hook's `onSuccess` wins and calls the
 * caller's from inside it.
 */

const HOOKS_DIR = path.join(__dirname, "..");

/** Index of the closing brace matching the object literal opened at `open`. */
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

/** Offsets (relative to the object body) that sit at the object's own depth. */
const topLevelOffsets = (src: string, open: number, close: number): Set<number> => {
  const out = new Set<number>();
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i <= close; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 1) out.add(i - open - 1);
  }
  return out;
};

/** First match of `re` that sits at the object's own depth, else -1. */
const findAtTopLevel = (body: string, offsets: Set<number>, re: RegExp): number => {
  const rx = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body))) if (offsets.has(m.index)) return m.index;
  return -1;
};

const lineOf = (src: string, index: number) =>
  src.slice(0, index).split("\n").length;

type Offence = { file: string; line: number };

const collectOffences = (): Offence[] => {
  const offences: Offence[] = [];

  for (const file of fs.readdirSync(HOOKS_DIR)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const src = fs.readFileSync(path.join(HOOKS_DIR, file), "utf8");

    let from = 0;
    for (;;) {
      const call = src.indexOf("useMutation", from);
      if (call === -1) break;

      const open = src.indexOf("{", src.indexOf("(", call));
      const close = open === -1 ? -1 : matchBrace(src, open);
      if (close === -1) break;

      const body = src.slice(open + 1, close);
      const offsets = topLevelOffsets(src, open, close);
      const spread = findAtTopLevel(body, offsets, /\.\.\.options\s*,/);
      const onSuccess = findAtTopLevel(body, offsets, /onSuccess\s*:/);

      if (spread !== -1 && onSuccess !== -1 && spread > onSuccess) {
        offences.push({ file, line: lineOf(src, open + 1 + spread) });
      }
      from = close;
    }
  }

  return offences;
};

describe("admin mutation hooks (#1800)", () => {
  it("never spreads `...options` after `onSuccess`", () => {
    const offences = collectOffences();

    expect(
      offences.map((o) => `${o.file}:${o.line}`)
    ).toEqual([]);
  });

  it("forwards the caller's onSuccess wherever the hook defines its own", () => {
    const missing: string[] = [];

    for (const file of fs.readdirSync(HOOKS_DIR)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const src = fs.readFileSync(path.join(HOOKS_DIR, file), "utf8");

      let from = 0;
      for (;;) {
        const call = src.indexOf("useMutation", from);
        if (call === -1) break;

        const open = src.indexOf("{", src.indexOf("(", call));
        const close = open === -1 ? -1 : matchBrace(src, open);
        if (close === -1) break;

        const body = src.slice(open + 1, close);
        const offsets = topLevelOffsets(src, open, close);
        const spread = findAtTopLevel(body, offsets, /\.\.\.options\s*,/);
        const onSuccess = findAtTopLevel(body, offsets, /onSuccess\s*:/);

        // Only hooks that accept `options` AND define their own handler can
        // swallow the caller's — a hook with neither has nothing to forward.
        if (spread !== -1 && onSuccess !== -1 && !/options\?\.onSuccess/.test(body)) {
          missing.push(`${file}:${lineOf(src, open + 1 + onSuccess)}`);
        }
        from = close;
      }
    }

    expect(missing).toEqual([]);
  });
});
