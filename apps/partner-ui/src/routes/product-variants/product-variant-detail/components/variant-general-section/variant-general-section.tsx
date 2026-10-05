import { Component, PencilSquare, Trash } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Badge, Container, Heading, usePrompt } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { ActionMenu } from "../../../../../components/common/action-menu"
import { SectionRow } from "../../../../../components/common/section"
import { useDeleteVariant } from "../../../../../hooks/api/products"

type VariantGeneralSectionProps = {
  variant: HttpTypes.AdminProductVariant
}

export function VariantGeneralSection({ variant }: VariantGeneralSectionProps) {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const navigate = useNavigate()

  // `variant.inventory` is not on this payload; `inventory_items` is. A kit is
  // more than one item OR one item used more than once (a 12 m pack).
  const kitLinks = ((variant as any).inventory_items ?? []) as Array<{
    required_quantity?: number
  }>
  const hasInventoryKit =
    kitLinks.length > 1 || kitLinks.some((i) => (i.required_quantity ?? 1) > 1)

  const { mutateAsync } = useDeleteVariant(variant.product_id!, variant.id)

  const handleDelete = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("products.variant.deleteWarning", {
        title: variant.title,
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    })

    if (!res) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        navigate("..", { replace: true })
      },
    })
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Heading>{variant.title}</Heading>
            {hasInventoryKit && (
              <span className="text-ui-fg-muted font-normal">
                <Component />
              </span>
            )}
          </div>
          <span className="text-ui-fg-subtle txt-small mt-2">
            {t("labels.productVariant")}
          </span>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit"),
                    to: "edit",
                    icon: <PencilSquare />,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.delete"),
                    onClick: handleDelete,
                    icon: <Trash />,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <SectionRow title={t("fields.sku")} value={variant.sku} />
      {variant.options?.map((o) => (
        <SectionRow
          key={o.id}
          title={o.option?.title!}
          value={<Badge size="2xsmall">{o.value}</Badge>}
        />
      ))}
    </Container>
  )
}
