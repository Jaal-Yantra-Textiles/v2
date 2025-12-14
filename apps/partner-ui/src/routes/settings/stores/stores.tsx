import { Badge, Container, Heading, Text } from "@medusajs/ui"

import { SingleColumnPage } from "../../../components/layout/pages"
import { SectionRow } from "../../../components/common/section"
import { usePartnerStores } from "../../../hooks/api/partner-stores"

export const SettingsStores = () => {
  const { stores, isPending, isError, error } = usePartnerStores()
  if (isError) {
    throw error
  }

  const store = stores?.[0]

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Store</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage your store's details
          </Text>
        </div>

        {isPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading...
            </Text>
          </div>
        ) : !store ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No store
            </Text>
          </div>
        ) : (
          <>
            <SectionRow title="Name" value={store?.name || "-"} />

            <SectionRow
              title="Default currency"
              value={
                store?.region?.[0]?.currency_code ? (
                  <Badge size="2xsmall">
                    {String(store.region[0].currency_code).toUpperCase()}
                  </Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default region"
              value={
                store?.region?.[0]?.name ? (
                  <Badge size="2xsmall">{String(store.region[0].name)}</Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default sales channel"
              value={
                store?.sales_channel?.[0]?.name ? (
                  <Badge size="2xsmall">
                    {String(store.sales_channel[0].name)}
                  </Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default location"
              value={
                store?.location?.[0]?.name ? (
                  <Badge size="2xsmall">{String(store.location[0].name)}</Badge>
                ) : (
                  "-"
                )
              }
            />
          </>
        )}
      </Container>
    </SingleColumnPage>
  )
}
