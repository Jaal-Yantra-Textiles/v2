import { SingleColumnPage } from "../../../components/layout/pages"
import { useExtension } from "../../../providers/extension-provider"
import { RequiresStore } from "../../../components/common/requires-store/requires-store"
import { TaxRegionListView } from "./components/tax-region-list-view"

export const TaxRegionsList = () => {
  const { getWidgets } = useExtension()

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("tax.list.before"),
        after: getWidgets("tax.list.after"),
      }}
      hasOutlet
    >
      <RequiresStore>
        <TaxRegionListView />
      </RequiresStore>
    </SingleColumnPage>
  )
}
