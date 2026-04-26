import { UIMatch, useParams, useLoaderData, LoaderFunctionArgs } from "react-router-dom"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"
import { SingleColumnPage } from "../../../../components/pages/single-column-pages"
import { useForm } from "../../../../hooks/api/forms"
import { formLoader } from "./loader"
import { FormGeneralSection } from "../../../../components/forms/form-general-section"
import { FormResponsesSection } from "../../../../components/forms/form-responses-section"

const FormDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof formLoader>>

  const { form, isLoading } = useForm(id!, {
    initialData,
  })

  if (isLoading || !form) {
    return <SingleColumnPageSkeleton sections={2} showJSON showMetadata />
  }

  return (
    <SingleColumnPage data={form} hasOutlet showJSON showMetadata>
      <FormGeneralSection form={form} />
      <FormResponsesSection formId={form.id} />
    </SingleColumnPage>
  )
}

export default FormDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return formLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return id
  },
}
