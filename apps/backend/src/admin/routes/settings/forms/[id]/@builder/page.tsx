import { Text } from "@medusajs/ui"
import { useParams, useLoaderData } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { useForm, useSetFormFields } from "../../../../../hooks/api/forms"
import { formLoader } from "../loader"
import { FormBuilder, FormBuilderField } from "../../../../../components/forms/form-builder"

export default function FormBuilderPage() {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof formLoader>>

  const { form, isLoading } = useForm(id!, {
    initialData,
  })

  const { mutateAsync, isPending } = useSetFormFields(id!)

  if (isLoading || !form) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading builder...</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  const initialFields: FormBuilderField[] = ((form.fields || []) as any[]).map((f) => ({
    field_id: f.id || crypto.randomUUID(),
    id: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
    required: !!f.required,
    placeholder: f.placeholder ?? null,
    help_text: f.help_text ?? null,
    options: (f.options as any) ?? null,
    validation: (f.validation as any) ?? null,
    order: typeof f.order === "number" ? f.order : 0,
    metadata: (f.metadata as any) ?? null,
  }))

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-2">
          <Text weight="plus">{form.title}</Text>
          <Text className="text-ui-fg-subtle">- Builder</Text>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        <FormBuilder
          form={form}
          initialFields={initialFields}
          isSaving={isPending}
          onSave={async (fields) => {
            await mutateAsync({ fields })
          }}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}
