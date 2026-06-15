import { CurrencyDollar, ShoppingBag, Swatch, TruckFast } from "@medusajs/icons"
import type { ComponentType } from "react"

// #342 — partner-facing "What's new" changelog surfaced on the dashboard
// carousel. This is the single place to curate announcements: prepend a new
// entry (newest first) and the carousel re-surfaces for every partner (the
// dismissed-state version is derived from the entry ids, so adding/removing an
// entry resets "seen"). Copy is kept inline here (changelog announcements aren't
// localized); the carousel chrome uses `partner.home.whatsNew.*` i18n keys.
//
// `media` points at a GIF (or still) under `public/whats-new/` — short Playwright
// screen-recordings of the real flows. If the file is absent or fails to load,
// the carousel falls back to `icon`.

export type WhatsNewEntry = {
  /** Stable id — drives the dismissed-state signature. Never reuse across changes. */
  id: string
  /** ISO date the change shipped (shown as a subtle timestamp). */
  date: string
  title: string
  body: string
  /** Optional GIF/still under public/whats-new/, e.g. "/whats-new/orders-unified.gif". */
  media?: string
  /** Fallback icon shown when `media` is absent or 404s. */
  icon: ComponentType<{ className?: string }>
  /** Optional CTA link (in-app path). */
  to?: string
  /** CTA label; falls back to partner.home.whatsNew.defaultCta. */
  cta?: string
}

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    id: "orders-unified-2026-06",
    date: "2026-06-15",
    title: "Orders, unified",
    body: "Your design and inventory work-orders now live alongside customer orders under Orders. Switch between Retail, Design, Inventory and All — each row shows its live work status.",
    media: "/whats-new/orders-unified.gif",
    icon: ShoppingBag,
    to: "/orders/all",
    cta: "View orders",
  },
  {
    id: "design-complete-2026-06",
    date: "2026-06-15",
    title: "Complete a design run",
    body: "Mark a run finished, then log your output, production cost and materials consumed to complete it — the activity timeline updates as you go.",
    media: "/whats-new/design-complete.gif",
    icon: Swatch,
    to: "/orders/design",
    cta: "Open design orders",
  },
  {
    id: "inventory-fulfillment-2026-06",
    date: "2026-06-15",
    title: "Confirm delivery & fulfill",
    body: "Complete an inventory order in one place — Fill All Remaining quantities, add a delivery date and tracking number, and mark it delivered.",
    media: "/whats-new/fulfillment.gif",
    icon: TruckFast,
    to: "/orders/inventory",
    cta: "Open inventory orders",
  },
  {
    id: "submit-payment-2026-06",
    date: "2026-06-15",
    title: "Submit a payment",
    body: "Record a payment against an inventory order straight from the order — the amount pre-fills from the total, add a method and note, done.",
    media: "/whats-new/submit-payment.gif",
    icon: CurrencyDollar,
    to: "/orders/inventory",
    cta: "Open inventory orders",
  },
]

// Dismissed-state signature: changes whenever the set of entries changes, so a
// new announcement re-surfaces the carousel even for partners who dismissed the
// previous set. Stored verbatim in localStorage.
export const WHATS_NEW_VERSION = WHATS_NEW_ENTRIES.map((e) => e.id).join("|")
