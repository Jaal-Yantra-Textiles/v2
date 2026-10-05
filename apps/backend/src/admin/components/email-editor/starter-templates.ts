import type { ThemeConfig } from "@react-email/editor/plugins"

/**
 * #2349 — brand defaults for the Email tab. The editor builds the INSIDE of the
 * `blog-subscriber` template (620px wide, 36px side padding), so the body and
 * container are transparent and edge-to-edge; the frame owns the masthead,
 * greeting and footer.
 */
export const JYT_EMAIL_THEME: ThemeConfig = {
  extends: "basic",
  styles: {
    body: { backgroundColor: "#ffffff", padding: "0px" },
    container: { maxWidth: "548px", padding: "0px" },
    h1: {
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontSize: "26px",
      lineHeight: "1.25",
      color: "#16151b",
    },
    h2: {
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontSize: "20px",
      lineHeight: "1.3",
      color: "#16151b",
    },
    paragraph: { fontSize: "15px", lineHeight: "1.75", color: "#454550" },
    link: { color: "#33348e" },
    button: {
      backgroundColor: "#33348e",
      color: "#ffffff",
      borderRadius: "8px",
      fontSize: "15px",
      fontWeight: "600",
      padding: "13px 30px",
    },
  },
}

const SHOP = "https://cicilabel.com"
const SITE = "https://jaalyantra.com"

// Placeholders are deliberately obvious stand-ins — select one and use the
// image menu to replace it with an uploaded photo.
const ph = (w: number, h: number, label: string) =>
  `https://placehold.co/${w}x${h}/ece9e3/33348e/png?text=${encodeURIComponent(label)}`

const img = (w: number, h: number, label: string, href?: string) =>
  `<img src="${ph(w, h, label)}" alt="${label}" width="${w}" alignment="center"${href ? ` href="${href}"` : ""}>`

const button = (label: string, href: string, alignment = "center") =>
  `<a data-id="react-email-button" href="${href}" alignment="${alignment}">${label}</a>`

const column = (inner: string) => `<div data-type="column">${inner}</div>`

export type StarterTemplate = {
  id: string
  name: string
  description: string
  html: string
}

/**
 * Starter layouts for the Email tab. None opens with an <h1>: the
 * blog-subscriber frame already prints the post title as the email's heading,
 * so a template heading is a section heading (h2/h3).
 * They are HTML because the editor reads
 * HTML directly (columns = div[data-type], buttons = a[data-id=react-email-button],
 * images = img with width/alignment/href attributes), and because our email
 * templates are HTML everywhere else too.
 */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Intro, hero image, two stories side by side, one call to action.",
    html: [
      `<p>A short opening line about what's new this month — a weave, a maker, a collection.</p>`,
      img(548, 300, "Hero image"),
      `<h2>This month</h2>`,
      `<div data-type="two-columns">`,
      column(`${img(260, 200, "Story one")}<h3>First story</h3><p>Two or three lines that make someone want to read on.</p>`),
      column(`${img(260, 200, "Story two")}<h3>Second story</h3><p>Two or three lines that make someone want to read on.</p>`),
      `</div>`,
      button("Read on jaalyantra.com", SITE),
      `<hr>`,
      `<p>Thank you for following the work of our weavers and makers.</p>`,
    ].join(""),
  },
  {
    id: "collection-launch",
    name: "New collection launch",
    description: "Big hero, three pieces in a row, shop button.",
    html: [
      img(548, 340, "Collection hero", SHOP),
      `<h2>The new collection is here</h2>`,
      `<p>One paragraph on the story behind it — the fabric, the region, the hands that made it.</p>`,
      `<div data-type="three-columns">`,
      column(`${img(170, 210, "Piece one", SHOP)}<p><strong>Piece name</strong><br>₹0,000</p>`),
      column(`${img(170, 210, "Piece two", SHOP)}<p><strong>Piece name</strong><br>₹0,000</p>`),
      column(`${img(170, 210, "Piece three", SHOP)}<p><strong>Piece name</strong><br>₹0,000</p>`),
      `</div>`,
      button("Shop the collection", SHOP),
    ].join(""),
  },
  {
    id: "product-spotlight",
    name: "Product spotlight",
    description: "One piece: photo beside its story, price and a buy button.",
    html: [
      `<h2>In the spotlight</h2>`,
      `<div data-type="two-columns">`,
      column(img(260, 320, "Product photo", SHOP)),
      column(
        `<h2>Product name</h2><p>Where it was woven, by whom, and what makes it different. Keep it to three or four lines.</p><p><strong>₹0,000</strong></p>${button("Buy now", SHOP, "left")}`
      ),
      `</div>`,
      `<hr>`,
      `<p>Each piece is handwoven and made in small numbers.</p>`,
    ].join(""),
  },
  {
    id: "blog-digest",
    name: "Blog digest",
    description: "Three recent posts, each with an image, a teaser and a read button.",
    html: [
      `<h2>Recently from the loom</h2>`,
      `<p>A few things we wrote about lately.</p>`,
      ...[1, 2, 3].flatMap((n) => [
        `<div data-type="two-columns">`,
        column(img(260, 170, `Post ${n}`)),
        column(`<h3>Post title ${n}</h3><p>One or two lines from the post.</p>${button("Read", SITE, "left")}`),
        `</div>`,
      ]),
    ].join(""),
  },
]
