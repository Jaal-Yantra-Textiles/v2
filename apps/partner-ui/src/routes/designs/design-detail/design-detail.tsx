import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { SectionRow } from "../../../components/common/section"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  usePartnerDesign,
} from "../../../hooks/api/partner-designs"
import { DesignActionsSection } from "./components/design-actions-section"
import { DesignMediaSection } from "./components/design-media-section"
import { DesignMoodboardSection } from "./components/design-moodboard-section"

export const DesignDetail = () => {
  const { id } = useParams()

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Design</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing design id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  const { design, isPending, isError, error } = usePartnerDesign(id)

  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>

  if (isError) {
    throw error
  }

  const inventoryItemRows = useMemo(() => {
    return inventoryItems.map((it) => {
      const label = it?.title || it?.name || it?.sku || it?.id
      return {
        id: String(it.id),
        label: String(label),
      }
    })
  }, [inventoryItems])

  const metadata = (design as any)?.metadata as Record<string, any> | undefined
  const notesValue = metadata?.notes
  const specsValue = metadata?.specs

  return (
    <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }} hasOutlet>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>{design?.name || "Design"}</Heading>
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    Status
                  </Text>
                  {design?.status ? (
                    <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                      {String(design.status)}
                    </Badge>
                  ) : (
                    <Text size="small" className="text-ui-fg-subtle">
                      -
                    </Text>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    Partner status
                  </Text>
                  {design?.partner_info?.partner_status ? (
                    <Badge
                      size="2xsmall"
                      color={getStatusBadgeColor(design.partner_info.partner_status)}
                    >
                      {String(design.partner_info.partner_status)}
                    </Badge>
                  ) : (
                    <Text size="small" className="text-ui-fg-subtle">
                      -
                    </Text>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Design ID" value={design?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              design?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                  {String(design.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow
            title="Partner status"
            value={
              design?.partner_info?.partner_status ? (
                <Badge
                  size="2xsmall"
                  color={getStatusBadgeColor(design.partner_info.partner_status)}
                >
                  {String(design.partner_info.partner_status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Inventory Items</Heading>
          </div>
          <div className="px-6 py-4">
            {inventoryItemRows.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No inventory items linked to this design.
              </Text>
            ) : (
              <div className="flex flex-col gap-y-2">
                {inventoryItemRows.map((row) => {
                  return (
                    <div key={row.id} className="rounded-lg border p-4">
                      <Text size="small" weight="plus" className="truncate">
                        {row.label}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {row.id}
                      </Text>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Notes</Heading>
          </div>
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
              {typeof notesValue === "string"
                ? notesValue || "-"
                : notesValue
                ? JSON.stringify(notesValue, null, 2)
                : "-"}
            </Text>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Specs</Heading>
          </div>
          {specsValue && typeof specsValue === "object" && !Array.isArray(specsValue) ? (
            Object.entries(specsValue as Record<string, any>).map(([key, value]) => (
              <SectionRow
                key={key}
                title={String(key)}
                value={
                  typeof value === "string" || typeof value === "number"
                    ? String(value)
                    : value
                    ? JSON.stringify(value)
                    : "-"
                }
              />
            ))
          ) : (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
                {typeof specsValue === "string"
                  ? specsValue || "-"
                  : specsValue
                  ? JSON.stringify(specsValue, null, 2)
                  : "-"}
              </Text>
            </div>
          )}
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {design && <DesignActionsSection design={design} isPending={isPending} />}
        {design && <DesignMediaSection design={design} />}
        {design && <DesignMoodboardSection design={design} />}
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
