import { ShoppingBag, Sparkles, Swatch } from "@medusajs/icons"
import type { ComponentType } from "react"

// #342 — partner-facing "What's new" changelog surfaced on the dashboard
// carousel. This is the single place to curate announcements: prepend a new
// entry (newest first) and the carousel re-surfaces for every partner (the
// dismissed-state version is derived from the entry ids, so adding/removing an
// entry resets "seen"). Copy is kept inline here (changelog announcements aren't
// localized); the carousel chrome uses `partner.home.whatsNew.*` i18n keys.
//
// `media` points at a GIF (or still) under `public/whats-new/`. If the file is
// absent or fails to load, the carousel falls back to `icon` — so entries can
// ship before their recording lands.

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
    body: "Your design and inventory work-orders now live alongside customer orders under Orders. Switch between Retail, Design, Inventory and All from the Orders submenu.",
    media: "/whats-new/orders-unified.gif",
    icon: ShoppingBag,
    to: "/orders/all",
    cta: "View orders",
  },
  {
    id: "work-order-detail-2026-06",
    date: "2026-06-15",
    title: "Manage a work-order in one place",
    body: "Open any design or inventory work-order to see its line items, totals, activity and tasks right inside the order — no more separate screens.",
    media: "/whats-new/work-order-detail.gif",
    icon: Swatch,
    to: "/orders/design",
    cta: "Open design orders",
  },
  {
    id: "work-status-badge-2026-06",
    date: "2026-06-15",
    title: "Work status at a glance",
    body: "Every work-order now carries a live status badge — assigned, accepted, in progress, finished, completed — on the list and the detail.",
    media: "/whats-new/work-status.gif",
    icon: Sparkles,
    to: "/orders/inventory",
    cta: "See statuses",
  },
]

// Dismissed-state signature: changes whenever the set of entries changes, so a
// new announcement re-surfaces the carousel even for partners who dismissed the
// previous set. Stored verbatim in localStorage.
export const WHATS_NEW_VERSION = WHATS_NEW_ENTRIES.map((e) => e.id).join("|")
