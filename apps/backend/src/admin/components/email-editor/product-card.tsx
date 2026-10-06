import { EmailNode } from "@react-email/editor/core"
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { CSSProperties } from "react"
import { EMAIL_BRAND as B } from "./email-brand"
import { productCardHref, type ProductCardAttrs } from "./product-card-data"

export const PRODUCT_CARD_NODE = "productCard"

type ProductCardOptions = {
  /** Read when the email HTML is built, so the link carries the post's current slug. */
  getUtmCampaign: () => string | null | undefined
}

const ATTR_KEYS: Array<keyof ProductCardAttrs> = [
  "productId",
  "handle",
  "title",
  "imageUrl",
  "priceLabel",
  "buttonLabel",
]
const dataAttr = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

// The frame's type and colours (email-brand.ts); the card is a fixed piece, not themed per node.
const TITLE_STYLE: CSSProperties = {
  fontFamily: B.serif,
  fontSize: "19px",
  lineHeight: "1.3",
  color: B.heading,
  paddingTop: "14px",
}
const PRICE_STYLE: CSSProperties = { fontSize: "14px", lineHeight: "1.5", color: B.muted, paddingTop: "4px" }
const BUTTON_STYLE: CSSProperties = {
  display: "inline-block",
  backgroundColor: B.ink,
  color: "#ffffff",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  padding: "13px 22px",
  textDecoration: "none",
}
const IMAGE_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  border: 0,
}

/** In the editor: what the email will show, so the founder sees the real card. */
const ProductCardView = ({ node, selected }: { node: { attrs: ProductCardAttrs }; selected: boolean }) => {
  const { title, imageUrl, priceLabel, buttonLabel } = node.attrs
  return (
    <NodeViewWrapper
      data-type="product-card"
      data-drag-handle
      className={`my-4 p-1 ${selected ? "outline outline-2 outline-[#d5b16d]" : ""}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={title} style={IMAGE_STYLE} draggable={false} />
      ) : (
        <div className="bg-ui-bg-subtle text-ui-fg-muted flex h-40 items-center justify-center text-sm">
          No photo
        </div>
      )}
      <div style={TITLE_STYLE}>{title}</div>
      {priceLabel ? (
        <div style={PRICE_STYLE}>{priceLabel}</div>
      ) : (
        <div style={{ ...PRICE_STYLE, color: "#b42318" }}>No price in this currency</div>
      )}
      <div style={{ paddingTop: "14px" }}>
        <span style={BUTTON_STYLE}>{buttonLabel}</span>
      </div>
    </NodeViewWrapper>
  )
}

/**
 * #2349 S4 — a house-store product in the email: photo, name, price and a Shop
 * button. The card is a snapshot taken when it is added (price included); the
 * link is built at send time from the handle.
 */
export const ProductCard = EmailNode.create<ProductCardOptions>({
  name: PRODUCT_CARD_NODE,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { getUtmCampaign: () => null }
  },

  addAttributes() {
    return Object.fromEntries(
      ATTR_KEYS.map((key) => [
        key,
        {
          default: key === "buttonLabel" ? "Shop now" : key === "title" ? "" : null,
          parseHTML: (el: HTMLElement) => el.getAttribute(dataAttr(key)),
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs[key] == null ? {} : { [dataAttr(key)]: String(attrs[key]) },
        },
      ])
    )
  },

  parseHTML() {
    return [{ tag: 'div[data-type="product-card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "product-card" }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProductCardView as any)
  },

  renderToReactEmail({ node, extension }) {
    const attrs = (node.attrs ?? {}) as ProductCardAttrs
    const options = extension.options as ProductCardOptions
    const href = productCardHref(attrs.handle, options.getUtmCampaign?.())
    return (
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ margin: "16px 0", borderCollapse: "collapse" }}
      >
        <tbody>
          {attrs.imageUrl && (
            <tr>
              <td>
                <a href={href} target="_blank">
                  <img src={attrs.imageUrl} alt={attrs.title} width="100%" style={IMAGE_STYLE} />
                </a>
              </td>
            </tr>
          )}
          <tr>
            <td style={TITLE_STYLE}>{attrs.title}</td>
          </tr>
          {attrs.priceLabel && (
            <tr>
              <td style={PRICE_STYLE}>{attrs.priceLabel}</td>
            </tr>
          )}
          <tr>
            <td style={{ paddingTop: "14px" }}>
              <a href={href} target="_blank" style={BUTTON_STYLE}>
                {attrs.buttonLabel || "Shop now"}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    )
  },
})
