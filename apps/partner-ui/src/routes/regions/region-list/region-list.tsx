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
        <RegionListTable />
      </RequiresStore>
    </SingleColumnPage>
  )
}
