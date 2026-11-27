/**
 * Ink drawings for "The making": a thin needle (its thread is drawn by
 * StitchedSection, through the pillars) and a button sewn on with a
 * cross-stitch. Original line work
 * (not traced from any reference): one ink weight, one red thread.
 */
const INK = "#1c1917"
const THREAD = "#b8322a"

/**
 * A thin, long sewing needle. Its eye is cut out of the body, and a marker
 * (`data-thread-eye`) sits on it so StitchedSection can start the thread
 * there; the thread is drawn behind, so it shows only through the eye.
 */
export const NeedleMark = ({ className }: { className?: string }) => (
  <span className={`relative inline-block ${className ?? ""}`}>
    <svg
      viewBox="0 0 40 160"
      aria-hidden
      // Explicit box: an auto-width SVG inside an inline-block collapses to
      // 0 px in Safari, leaving the thread with no needle.
      className="block h-full w-full"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(8 20 80)">
        <path
          fillRule="evenodd"
          fill="#ffffff"
          stroke={INK}
          strokeWidth="1.1"
          d="M 20 7 C 21.5 7 21.7 9.5 21.7 13 L 21.7 118 C 21.7 134 20.6 146 20 157 C 19.4 146 18.3 134 18.3 118 L 18.3 13 C 18.3 9.5 18.5 7 20 7 Z M 20 14 C 20.7 14 20.8 15.5 20.8 17 L 20.8 31 C 20.8 32.6 20.4 33.4 20 33.4 C 19.6 33.4 19.2 32.6 19.2 31 L 19.2 17 C 19.2 15.5 19.3 14 20 14 Z"
        />
      </g>
    </svg>
    {/* The eye, once tilted: (27.8, 24.5) of 40 × 160. */}
    <span
      data-thread-eye
      aria-hidden
      className="absolute h-px w-px"
      style={{ left: "69.5%", top: "15.3%" }}
    />
  </span>
)

export const ButtonMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 200 200"
    aria-hidden
    className={className}
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Button: outer edge, inner rim, four holes. */}
    <circle cx="100" cy="100" r="62" stroke={INK} strokeWidth="1.6" />
    <circle cx="100" cy="100" r="50" stroke={INK} strokeOpacity="0.55" strokeWidth="1" />
    {[
      [84, 84],
      [116, 84],
      [84, 116],
      [116, 116],
    ].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7.5" stroke={INK} strokeWidth="1.4" />
    ))}

    {/* Cross-stitch through all four holes. */}
    <path d="M 84 84 L 116 116 M 116 84 L 84 116" stroke={THREAD} strokeWidth="2.6" />

    {/* A short loose tail, as if the knot was just tied. */}
    <path
      d="M 84 116 C 72 132 70 150 82 160 C 92 168 108 160 104 150 C 100 142 88 150 94 170 C 98 182 112 188 126 186"
      stroke={THREAD}
      strokeWidth="1.8"
    />
  </svg>
)
