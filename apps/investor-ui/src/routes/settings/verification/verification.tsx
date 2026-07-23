import { useMe } from "../../../hooks/api/users"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import { LayoutComposer } from "../../../components/layout-composer"
import { CORE_LAYOUT_IDS } from "@medusajs/admin-shared"
import { VerificationSection } from "./components/verification-section/verification-section"

export const Verification = () => {
  const { user, isPending: isLoading, isError, error } = useMe()

  if (isLoading || !user) {
    return <SingleColumnPageSkeleton sections={1} />
  }

  if (isError) {
    throw error
  }

  return (
    <LayoutComposer
      widgetsZonePrefix="settings.verification"
      preferredLayoutId={CORE_LAYOUT_IDS.SINGLE_COLUMN}
      sections={{
        main: (
          <LayoutComposer.Entry id="VerificationSection">
            <VerificationSection investor={user as any} />
          </LayoutComposer.Entry>
        ),
      }}
    />
  )
}
