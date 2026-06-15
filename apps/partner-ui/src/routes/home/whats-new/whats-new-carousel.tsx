import { Button, Container, IconButton, Text, clx } from "@medusajs/ui"
import { Sparkles, XMarkMini } from "@medusajs/icons"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { WHATS_NEW_ENTRIES, WHATS_NEW_VERSION } from "./whats-new-entries"

// Dashboard "What's new" announcement carousel (#342). Auto-rotates through the
// curated changelog entries, with dots + a dismiss. Dismissal is remembered per
// browser via a version signature derived from the entry ids, so a new
// announcement re-surfaces the carousel. Media (GIF/still) falls back to the
// entry icon if absent or 404 — so entries ship before their recording lands.
const SEEN_KEY = "partner_whats_new_seen_version"
const ADVANCE_MS = 6000

export const WhatsNewCarousel = () => {
  const { t } = useTranslation()
  const entries = WHATS_NEW_ENTRIES

  // Start hidden so already-dismissed partners never see a flash; reveal after
  // the localStorage check resolves on mount.
  const [dismissed, setDismissed] = useState(true)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  const [mediaFailed, setMediaFailed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(SEEN_KEY) === WHATS_NEW_VERSION)
    } catch {
      setDismissed(false)
    }
  }, [])

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }, [])

  // Auto-advance (paused on hover, when reduced motion is preferred, or for a
  // single entry).
  useEffect(() => {
    if (dismissed || paused || prefersReducedMotion || entries.length <= 1) {
      return
    }
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % entries.length),
      ADVANCE_MS
    )
    return () => window.clearInterval(id)
  }, [dismissed, paused, prefersReducedMotion, entries.length])

  // Cross-fade on slide change.
  useEffect(() => {
    setVisible(false)
    const id = window.setTimeout(() => setVisible(true), 60)
    return () => window.clearTimeout(id)
  }, [index])

  if (dismissed || !entries.length) {
    return null
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, WHATS_NEW_VERSION)
    } catch {
      /* private mode — just hide for this session */
    }
    setDismissed(true)
  }

  const active = entries[index]
  const Icon = active.icon
  const showMedia = active.media && !mediaFailed[active.id]

  return (
    <Container
      className="p-0 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-x-1.5">
          <Sparkles className="text-ui-fg-interactive h-4 w-4" />
          <Text size="small" weight="plus">
            {t("partner.home.whatsNew.heading")}
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          {entries.length > 1 && (
            <div className="flex items-center gap-x-1">
              {entries.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  aria-label={t("partner.home.whatsNew.goToUpdate", {
                    index: i + 1,
                  })}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                  className={clx(
                    "h-1.5 rounded-full outline-none transition-all focus-visible:shadow-borders-focus",
                    i === index
                      ? "bg-ui-fg-base w-4"
                      : "bg-ui-border-strong hover:bg-ui-fg-muted w-1.5"
                  )}
                />
              ))}
            </div>
          )}
          <IconButton
            size="small"
            variant="transparent"
            aria-label={t("partner.home.whatsNew.dismiss")}
            onClick={handleDismiss}
          >
            <XMarkMini />
          </IconButton>
        </div>
      </div>

      <div
        className={clx(
          "flex items-center gap-x-4 px-4 pb-4 pt-2 transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="border-ui-border-base bg-ui-bg-subtle relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border">
          {showMedia ? (
            <img
              src={active.media}
              alt=""
              className="h-full w-full object-cover"
              onError={() =>
                setMediaFailed((m) => ({ ...m, [active.id]: true }))
              }
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Icon className="text-ui-fg-muted h-7 w-7" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <Text size="small" weight="plus" className="truncate">
            {active.title}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle mt-0.5 line-clamp-2">
            {active.body}
          </Text>
        </div>

        {active.to && (
          <Button size="small" variant="secondary" asChild className="shrink-0">
            <Link to={active.to}>
              {active.cta || t("partner.home.whatsNew.defaultCta")}
            </Link>
          </Button>
        )}
      </div>
    </Container>
  )
}
