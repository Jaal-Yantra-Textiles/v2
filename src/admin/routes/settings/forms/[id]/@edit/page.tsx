import { useParams, useLoaderData } from "react-router-dom"
import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { useForm } from "../../../../../hooks/api/forms"
import { formLoader } from "../loader"
import { EditFormComponent } from "../../../../../components/edits/edit-form"

export default function EditFormPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof formLoader>>

  const { form, isLoading } = useForm(id!, {
    initialData,
  })

  if (isLoading || !form) {
    return null
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("Edit Form")}</Heading>
      </RouteDrawer.Header>
      <EditFormComponent form={form} />
    </RouteDrawer>
  )
}
