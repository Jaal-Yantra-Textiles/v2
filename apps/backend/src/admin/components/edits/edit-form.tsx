import { DynamicForm, FieldConfig } from "../common/dynamic-form"
import { toast } from "sonner"
import { useRouteModal } from "../../components/modal/use-route-modal"
import { AdminForm, useUpdateForm } from "../../hooks/api/forms"

type EditFormComponentProps = {
  form: AdminForm
}

export const EditFormComponent = ({ form }: EditFormComponentProps) => {
  const { mutateAsync, isPending } = useUpdateForm(form.id)
  const { handleSuccess } = useRouteModal()

  const handleSubmit = async (data: any) => {
    try {
      await mutateAsync(data)
      toast.success("Form updated successfully")
      handleSuccess()
    } catch {
      toast.error("Failed to update form")
    }
  }

  const fields: FieldConfig<any>[] = [
    { name: "title", type: "text", label: "Title", required: true },
    { name: "handle", type: "text", label: "Handle", required: true },
    { name: "domain", type: "text", label: "Domain", required: false },
    {
      name: "status",
      type: "select",
      label: "Status",
      required: true,
      options: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
        { value: "archived", label: "Archived" },
      ],
    },
    { name: "description", type: "text", label: "Description", required: false },
    { name: "submit_label", type: "text", label: "Submit label", required: false },
    { name: "success_message", type: "text", label: "Success message", required: false },
  ]

  return (
    <DynamicForm<any>
      fields={fields}
      defaultValues={{
        title: form.title || "",
        handle: form.handle || "",
        domain: form.domain || "",
        status: form.status || "draft",
        description: form.description || "",
        submit_label: form.submit_label || "",
        success_message: form.success_message || "",
      }}
      onSubmit={handleSubmit}
      layout={{
        showDrawer: true,
        gridCols: 1,
      }}
      isPending={isPending}
    />
  )
}
