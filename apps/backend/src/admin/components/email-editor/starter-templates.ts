import type { ThemeConfig } from "@react-email/editor/plugins"
import { EMAIL_BRAND as B } from "./email-brand"

/**
 * #2349 — brand defaults for the Email tab. The editor builds the INSIDE of the
 * `blog-subscriber` template: its article cell is 620px wide with 42px side
 * padding, so the content is 536px and sits on the frame's paper. Type and
 * colour follow the frame (email-brand.ts) — square ink buttons, Georgia
 * headings at normal weight, the frame's 15px/1.8 article text.
 */
export const JYT_EMAIL_THEME: ThemeConfig = {
  extends: "basic",
  styles: {
    body: { backgroundColor: B.paper, padding: "0px" },
    container: { maxWidth: "536px", padding: "0px", backgroundColor: B.paper },
    h1: {
      fontFamily: B.serif,
      fontSize: "30px",
      fontWeight: "400",
      lineHeight: "1.15",
      letterSpacing: "-0.02em",
      color: B.heading,
    },
    h2: {
      paddingBottom: "14px",
      fontFamily: B.serif,
      fontSize: "24px",
      fontWeight: "400",
      lineHeight: "1.2",
      letterSpacing: "-0.02em",
      color: B.heading,
    },
    h3: {
      paddingBottom: "8px",
      fontFamily: B.serif,
      fontSize: "19px",
      fontWeight: "400",
      lineHeight: "1.3",
      color: B.heading,
    },
    paragraph: { fontSize: "15px", lineHeight: "1.8", color: B.body },
    link: { color: B.heading, textDecoration: "underline" },
    image: { borderRadius: "0px" },
    button: {
      backgroundColor: B.ink,
      color: "#ffffff",
      borderRadius: "0px",
      fontSize: "12px",
      fontWeight: "600",
      letterSpacing: "0.04em",
      // Per side: the base theme sets each side in em, which beats a shorthand.
      paddingTop: "14px",
      paddingRight: "24px",
      paddingBottom: "14px",
      paddingLeft: "24px",
    },
  },
}

const SHOP = "https://cicilabel.com"
const SITE = "https://jaalyantra.com"

// Placeholders are deliberately obvious stand-ins in the frame's own tones —
// select one and use the image menu to replace it with an uploaded photo.
const ph = (w: number, h: number, label: string) =>
  `https://placehold.co/${w}x${h}/eeece5/817d74/png?text=${encodeURIComponent(label)}`

const img = (w: number, h: number, label: string, href?: string) =>
  `<img src="${ph(w, h, label)}" alt="${label}" width="${w}" alignment="center"${href ? ` href="${href}"` : ""}>`

const button = (label: string, href: string, alignment = "left") =>
  `<a data-id="react-email-button" href="${href}" alignment="${alignment}">${label}</a>`

/** Columns with a 20px gutter, split across the neighbours so they stay equal. */
const columns = (n: 2 | 3, inner: string[]) => {
  const pad = (i: number) => {
    const left = i === 0 ? 0 : n === 2 ? 10 : i === 1 ? 7 : 14
    const right = i === n - 1 ? 0 : n === 2 ? 10 : i === 0 ? 14 : 7
    return `padding:0 ${right}px 0 ${left}px`
  }
  const cells = inner.map((html, i) => `<div data-type="column" style="${pad(i)}">${html}</div>`).join("")
  return `<div data-type="${n === 2 ? "two" : "three"}-columns">${cells}</div>`
}

/** The frame's small uppercase label ("Journal", "Filed under"). */
const eyebrow = (text: string, color: string = B.muted) =>
  `<p style="font-size:10px;line-height:1.4;letter-spacing:0.16em;text-transform:uppercase;color:${color};font-weight:600;margin:0 0 10px">${text}</p>`

const small = (text: string) => `<p style="font-size:13px;line-height:1.6;color:${B.muted};margin:4px 0 0">${text}</p>`

const quote = (text: string, who?: string) =>
  `<blockquote style="border-left:2px solid ${B.gold};padding:2px 0 2px 20px;margin:28px 0">` +
  `<p style="font-family:${B.serif};font-style:italic;font-size:19px;line-height:1.55;color:${B.heading};margin:0">${text}</p>` +
  (who ? `<p style="font-size:12px;line-height:1.5;letter-spacing:0.04em;color:${B.muted};margin:10px 0 0">— ${who}</p>` : "") +
  `</blockquote>`

const rule = () => `<hr style="border:none;border-top:1px solid ${B.rule};margin:32px 0">`

/** A tinted panel, like the frame's "Keep exploring" box. */
const panel = (inner: string) =>
  `<section data-type="section" style="background-color:${B.panel};padding:24px 24px 20px">${inner}</section>`

export type StarterTemplate = {
  id: string
  name: string
  description: string
  html: string
}

/**
 * Starter layouts for the Email tab. None opens with an <h1>: the
 * blog-subscriber frame already prints the post title as the email's heading,
 * so a template heading is a section heading (h2/h3). The frame also ends
 * every email with "Read the full story" and the shop/create buttons, so a
 * template's own button is about ITS subject, not the blog post.
 *
 * They are HTML because the editor reads HTML directly (columns =
 * div[data-type], buttons = a[data-id=react-email-button], images = img with
 * width/alignment/href, inline `style` kept on paragraphs, headings, quotes,
 * dividers and sections), and because our email templates are HTML everywhere
 * else too.
 */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Opening note, hero image, two stories side by side.",
    html: [
      eyebrow("This month"),
      `<p>A short opening line about what's new this month — a weave, a maker, a collection.</p>`,
      img(536, 300, "Hero image"),
      small("A caption for the photograph: where, and who."),
      rule(),
      `<h2>What we've been making</h2>`,
      columns(2, [
        `${img(258, 200, "Story one")}${eyebrow("Story")}<h3>First story</h3><p>Two or three lines that make someone want to read on.</p>`,
        `${img(258, 200, "Story two")}${eyebrow("Story")}<h3>Second story</h3><p>Two or three lines that make someone want to read on.</p>`,
      ]),
      rule(),
      `<p>Thank you for following the work of our weavers and makers.</p>`,
    ].join(""),
  },
  {
    id: "studio-letter",
    name: "Studio letter",
    description: "A personal, text-first letter. No pictures — just the words.",
    html: [
      eyebrow("A letter from the studio"),
      `<p>A first line that sounds like you talking — where you are, what the light is like, what's on the loom.</p>`,
      `<p>A paragraph about the thing that's been on your mind. Keep it to four or five lines; a letter reads best in short paragraphs.</p>`,
      quote("One line worth slowing down for — something a weaver said, or something you noticed.", "Name, place"),
      `<p>A closing paragraph: what comes next, and what you'd like them to do, if anything.</p>`,
      `<p style="font-family:${B.serif};font-style:italic;font-size:17px;color:${B.heading};margin-top:24px">— Saransh</p>`,
    ].join(""),
  },
  {
    id: "maker-profile",
    name: "Maker profile",
    description: "Portrait, a quote in their words, their craft and region.",
    html: [
      eyebrow("Meet the maker"),
      `<h2>Name of the maker</h2>`,
      img(536, 380, "Portrait"),
      small("Photographed at their workshop in the village, month year."),
      quote("Something they said about the work, in their own words.", "Name"),
      `<p>Two short paragraphs: how they came to this craft, what a working day looks like, and what makes their pieces theirs.</p>`,
      panel(
        columns(2, [
          `${eyebrow("Craft")}<p style="margin:0;font-family:${B.serif};font-size:17px;color:${B.heading}">Handloom weaving</p>`,
          `${eyebrow("Region")}<p style="margin:0;font-family:${B.serif};font-size:17px;color:${B.heading}">Phulia, West Bengal</p>`,
        ])
      ),
      `<p></p>`,
      button("See their pieces", SHOP),
    ].join(""),
  },
  {
    id: "behind-the-weave",
    name: "Behind the weave",
    description: "A process story in three numbered steps, picture beside text.",
    html: [
      eyebrow("Process"),
      `<h2>From yarn to cloth</h2>`,
      `<p>One paragraph to set up the story: which piece, which fabric, how long it takes.</p>`,
      ...["01", "02", "03"].flatMap((n, i) => [
        rule(),
        columns(2, [
          img(258, 200, `Step ${i + 1}`),
          `${eyebrow(n, B.gold)}<h3>Step name</h3><p>Two or three lines on what happens here and whose hands do it.</p>`,
        ]),
      ]),
      rule(),
      button("Read the full process", SITE),
    ].join(""),
  },
  {
    id: "the-edit",
    name: "The edit",
    description: "A curated set of four pieces with a line on why each.",
    html: [
      eyebrow("The edit"),
      `<h2>Four pieces for the season</h2>`,
      `<p>One line on what ties them together — a colour, a fabric, a way of wearing them.</p>`,
      ...[
        ["Piece one", "Piece two"],
        ["Piece three", "Piece four"],
      ].map((pair) =>
        columns(
          2,
          pair.map(
            (label) =>
              `${img(258, 320, label, SHOP)}<h3>${label}</h3>${small("Fabric · where it was made")}<p style="margin:6px 0 18px;color:${B.heading}">₹0,000</p>`
          )
        )
      ),
      button("See the edit", SHOP),
      small("Tip: use the Product button to swap a placeholder for a real product card."),
    ].join(""),
  },
  {
    id: "collection-launch",
    name: "New collection launch",
    description: "Big hero, the story behind it, three pieces in a row.",
    html: [
      img(536, 340, "Collection hero", SHOP),
      `<p></p>`,
      eyebrow("New collection"),
      `<h2>The new collection is here</h2>`,
      `<p>One paragraph on the story behind it — the fabric, the region, the hands that made it.</p>`,
      columns(3, [1, 2, 3].map((n) => `${img(164, 210, `Piece ${n}`, SHOP)}<h3>Piece name</h3>${small("₹0,000")}`)),
      `<p></p>`,
      button("Shop the collection", SHOP),
    ].join(""),
  },
  {
    id: "product-spotlight",
    name: "Product spotlight",
    description: "One piece: photo beside its story, details and a buy button.",
    html: [
      columns(2, [
        img(258, 340, "Product photo", SHOP),
        `${eyebrow("In the spotlight")}<h2>Product name</h2><p>Where it was woven, by whom, and what makes it different. Keep it to three or four lines.</p>${small("Handwoven · 100% linen · Phulia")}<p style="font-family:${B.serif};font-size:19px;color:${B.heading};margin:12px 0 16px">₹0,000</p>${button("Shop now", SHOP)}`,
      ]),
      rule(),
      `<p>Each piece is handwoven and made in small numbers.</p>`,
    ].join(""),
  },
  {
    id: "invitation",
    name: "Invitation",
    description: "An open studio, a workshop or a pop-up: when, where, RSVP.",
    html: [
      eyebrow("You're invited"),
      `<h2>An afternoon at the studio</h2>`,
      img(536, 300, "The place"),
      `<p></p>`,
      panel(
        columns(2, [
          `${eyebrow("When")}<p style="margin:0;font-family:${B.serif};font-size:17px;color:${B.heading}">Saturday, 12 October<br>3 – 6 pm</p>`,
          `${eyebrow("Where")}<p style="margin:0;font-family:${B.serif};font-size:17px;color:${B.heading}">Studio name<br>Street, town</p>`,
        ])
      ),
      `<p style="margin-top:20px">A short paragraph: what will happen, who will be there, whether to bring anything.</p>`,
      button("Save your place", SITE),
    ].join(""),
  },
  {
    id: "blog-digest",
    name: "Blog digest",
    description: "Three recent posts, each with an image, a teaser and a link.",
    html: [
      eyebrow("From the journal"),
      `<h2>Recently from the loom</h2>`,
      `<p>A few things we wrote about lately.</p>`,
      ...[1, 2, 3].flatMap((n) => [
        rule(),
        columns(2, [
          img(258, 170, `Post ${n}`),
          `${eyebrow("Journal")}<h3>Post title ${n}</h3><p>One or two lines from the post.</p>${button("Read", SITE)}`,
        ]),
      ]),
    ].join(""),
  },
]
