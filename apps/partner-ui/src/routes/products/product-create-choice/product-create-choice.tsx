import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Button, Heading, Text } from "@medusajs/ui"
import { BoltSolid, Wrench } from "@medusajs/icons"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"

export const ProductCreateChoice = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { handleSuccess } = useRouteModal()

  const pick = (path: "quick" | "advanced") => {
    if (path === "quick") {
      navigate("/products/create/quick", { replace: true })
    } else {
      navigate("/products/create/advanced", { replace: true })
    }
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">{t("products.create.chooseMode")}</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          {t("products.create.chooseModeDescription")}
        </span>
      </RouteFocusModal.Description>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex size-full items-center justify-center">
        <div className="flex flex-col items-center gap-y-6 px-4 py-12 w-full max-w-3xl">
          <div className="text-center">
            <Heading level="h1" className="text-2xl">
              How do you want to create this product?
            </Heading>
            <Text size="base" className="text-ui-fg-subtle mt-2">
              Pick <strong>Quick</strong> for simple products with one price
              and one stock number. Pick <strong>Advanced</strong> if you
              sell in multiple variants, regions, or locations.
            </Text>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <button
              type="button"
              onClick={() => pick("quick")}
              className="group text-left border border-ui-border-base rounded-lg p-6 hover:border-ui-border-interactive hover:bg-ui-bg-subtle-hover transition"
            >
              <div className="flex items-center gap-x-2 mb-2">
                <BoltSolid className="text-ui-fg-interactive" />
                <Heading level="h2" className="text-lg">
                  Quick add
                </Heading>
              </div>
              <Text
                size="small"
                className="text-ui-fg-subtle leading-relaxed"
              >
                One photo, title, price, stock. Good for a single handmade
                piece. Takes about 30 seconds.
              </Text>
            </button>

            <button
              type="button"
              onClick={() => pick("advanced")}
              className="group text-left border border-ui-border-base rounded-lg p-6 hover:border-ui-border-interactive hover:bg-ui-bg-subtle-hover transition"
            >
              <div className="flex items-center gap-x-2 mb-2">
                <Wrench className="text-ui-fg-muted" />
                <Heading level="h2" className="text-lg">
                  Advanced
                </Heading>
              </div>
              <Text
                size="small"
                className="text-ui-fg-subtle leading-relaxed"
              >
                Variants (size / colour), region-based prices, multiple
                locations, full SEO and organisation fields.
              </Text>
            </button>
          </div>

          <RouteFocusModal.Close asChild>
            <Button
              variant="transparent"
              size="small"
              onClick={() => handleSuccess("..")}
            >
              Cancel
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}
