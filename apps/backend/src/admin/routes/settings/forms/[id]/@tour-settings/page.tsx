import { useParams, useLoaderData } from "react-router-dom"
import { Text } from "@medusajs/ui"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { useForm } from "../../../../../hooks/api/forms"
import { formLoader } from "../loader"
import { EditTourSettingsComponent } from "../../../../../components/edits/edit-tour-settings"

export default function EditTourSettingsPage() {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof formLoader>>

  const { form, isLoading } = useForm(id!, { initialData })

  if (isLoading || !form) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading tour settings…</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  return (
    <RouteFocusModal>
      <EditTourSettingsComponent form={form} />
    </RouteFocusModal>
  )
}
