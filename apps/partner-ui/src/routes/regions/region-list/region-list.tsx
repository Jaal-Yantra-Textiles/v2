import { Alert } from "@medusajs/ui"
import { SingleColumnPage } from "../../../components/layout/pages"
import { useExtension } from "../../../providers/extension-provider"
import { RequiresStore } from "../../../components/common/requires-store/requires-store"
import { RegionListTable } from "./components/region-list-table"

export const RegionList = () => {
  const { getWidgets } = useExtension()

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("region.list.before"),
        after: getWidgets("region.list.after"),
      }}
    >
      <RequiresStore>
        {/*
          Informational banner explaining that JYT-provided regions
          are read at the storefront automatically — partners get the
          default tax/payment/currency setup for free. If they want to
          customize, the path is to create their own region via the
          existing "Create Region" button rather than editing the
          shared admin-managed ones (which the backend refuses with a
          409 anyway when there are assigned countries).
        */}
        <Alert
          variant="info"
          dismissible
          className="bg-ui-bg-base mb-4"
        >
          Some regions below are provided by JYT — they ship with
          managed payment providers and tax setup so your storefront
          works out of the box. To customize for your store, click
          "Create Region" and set up your own.
        </Alert>
        <RegionListTable />
      </RequiresStore>
    </SingleColumnPage>
  )
}
