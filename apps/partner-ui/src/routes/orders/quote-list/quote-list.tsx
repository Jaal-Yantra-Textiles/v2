import { SingleColumnPage } from "../../../components/layout/pages"
import { RequiresStore } from "../../../components/common/requires-store/requires-store"
import { useExtension } from "../../../providers/extension-provider"
import { QuoteListTable } from "./components/quote-list-table"

/**
 * Orders → Quotes (#1389 S3).
 *
 * `hasOutlet` because `create` mounts as a child route inside a focus modal,
 * the same shape every other create flow here uses. `RequiresStore` because
 * minting resolves the partner's store — `POST /partners/quotes` calls
 * `getPartnerStore`, which throws without one.
 */
export const QuoteList = () => {
  const { getWidgets } = useExtension()

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("quote.list.before"),
        after: getWidgets("quote.list.after"),
      }}
      hasOutlet
    >
      <RequiresStore>
        <QuoteListTable />
      </RequiresStore>
    </SingleColumnPage>
  )
}
