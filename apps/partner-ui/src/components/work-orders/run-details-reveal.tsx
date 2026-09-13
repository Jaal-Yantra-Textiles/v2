import { Button, Text } from "@medusajs/ui"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

/**
 * Everything about the job that is not the next action (#2018).
 *
 * Founder's ask: *"show start only and then reveal each section"*. Once the
 * partner has taken the job, this is just the page — the children render
 * exactly as they always did, in the same order, with no wrapper chrome.
 *
 * ⚠️ Before that, it collapses rather than disappears. A partner deciding
 * whether to ACCEPT is precisely the person who may want to read the spec
 * first; hiding it outright would answer a question nobody asked and hide the
 * one they have. #2018's own wording: "hidden, not deleted".
 *
 * 📱 The collapsed state is also the mobile win. At 400px the spec, sizes, BOM
 * and costing push the only actionable thing off the first screen entirely.
 */
export const RunDetailsReveal = ({
  revealed,
  children,
}: {
  /** true once the phase has earned these sections — then this is a no-op. */
  revealed: boolean
  children: ReactNode
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (revealed) {
    // Deliberately NOT wrapped in a fragment with extra markup — a revealed
    // page must be byte-for-byte the layout that shipped before.
    return <>{children}</>
  }

  return (
    <>
      {!open && (
        <div className="flex flex-col gap-y-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Text size="small" weight="plus">
              {t("partner.workOrders.details")}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.workOrders.detailsHint")}
            </Text>
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setOpen(true)}
            className="w-full shrink-0 sm:w-auto"
          >
            {t("partner.workOrders.details")}
          </Button>
        </div>
      )}
      {open && children}
    </>
  )
}
