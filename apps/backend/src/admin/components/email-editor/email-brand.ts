/**
 * #2349 — the colours and type of the `blog-subscriber` email frame (the live
 * email_templates row), so what the Email tab builds sits inside it as one
 * piece: warm paper, near-black ink, a gold accent, Georgia headings, square
 * buttons. Indigo is the frame's own accent stripe; the inside stays ink.
 */
export const EMAIL_BRAND = {
  paper: "#fcfbf8",
  panel: "#eeece5",
  ink: "#24231f",
  heading: "#1e1d19",
  body: "#45433e",
  muted: "#817d74",
  rule: "#e6e1d8",
  gold: "#d5b16d",
  serif: "Georgia, 'Times New Roman', serif",
} as const
