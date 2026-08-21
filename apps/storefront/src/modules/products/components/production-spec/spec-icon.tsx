/**
 * #1364 — the glyph beside a spec row.
 *
 * The name comes from the weaving-technique registry, which is where a param is
 * defined; it is NOT looked up here on the param's key. A mapping kept
 * storefront-side would silently lose its entry the day someone adds a param —
 * the row would still render, just naked, and nobody would notice.
 *
 * An unrecognised name falls back to a neutral mark. A spec written against a
 * newer registry than this storefront has deployed must render a plain row, not
 * a blank space and certainly not a crash.
 *
 * Drawn as inline SVG on a 24-box with `currentColor`, so the glyphs inherit the
 * partner's text colour and need no asset pipeline, no sprite and no request.
 * Deliberately about MEASUREMENT rather than decoration: a row reading
 * "Weight · 240 GSM" wants a scale, not a picture of cloth.
 */

export type SpecIconName =
  | "weave"
  | "weight"
  | "warp"
  | "weft"
  | "yarn"
  | "width"
  | "angle"
  | "density"
  | "loom"
  | "metal"
  | "finish"
  | "note"

const PATHS: Record<SpecIconName, React.ReactNode> = {
  // Interlaced warp and weft — the thing itself.
  weave: (
    <>
      <path d="M4 8h16M4 12h16M4 16h16" />
      <path d="M8 4v16M12 4v16M16 4v16" />
    </>
  ),
  // A balance. GSM is grams per square metre.
  weight: (
    <>
      <path d="M12 4v16M7 20h10" />
      <path d="M4 8h16" />
      <path d="M4 8l-2 5a3 3 0 006 0L4 8zM20 8l-2 5a3 3 0 006 0l-4-5z" />
    </>
  ),
  // Warp runs the length of the cloth — vertical.
  warp: <path d="M6 3v18M10 3v18M14 3v18M18 3v18" />,
  // Weft crosses it — horizontal.
  weft: <path d="M3 6h18M3 10h18M3 14h18M3 18h18" />,
  // A cone of yarn.
  yarn: (
    <>
      <path d="M12 3l5 15H7L12 3z" />
      <path d="M8 21h8" />
      <path d="M9 12h6M8 15h8" />
    </>
  ),
  // Loom width — a measured span.
  width: (
    <>
      <path d="M3 12h18" />
      <path d="M6 9l-3 3 3 3M18 9l3 3-3 3" />
      <path d="M3 5v3M21 5v3" />
    </>
  ),
  // The angle of a twill line.
  angle: (
    <>
      <path d="M4 20h16" />
      <path d="M4 20L18 6" />
      <path d="M4 20a8 8 0 007-4" />
    </>
  ),
  // Knots per square inch — a filled grid.
  density: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </>
  ),
  // The loom's own machinery — shafts, hooks, bobbins.
  loom: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 9h16M4 15h16" />
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  // Zari — metal thread.
  metal: (
    <>
      <path d="M12 3l2.2 5.6L20 10l-4.4 3.4L17 19l-5-3-5 3 1.4-5.6L4 10l5.8-1.4L12 3z" />
    </>
  ),
  // Finishing — a treatment applied after weaving.
  finish: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </>
  ),
  // The neutral fallback: a partner's own field, or a param this build has
  // never heard of.
  note: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M15 4v4h4" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
}

const SpecIcon = ({
  name,
  className,
}: {
  name?: string | null
  className?: string
}) => {
  const key = (name || "note") as SpecIconName
  const path = PATHS[key] ?? PATHS.note

  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-spec-icon={key}
    >
      {path}
    </svg>
  )
}

export default SpecIcon
