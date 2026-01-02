import { PencilSquare, SquaresPlus, Trash } from "@medusajs/icons"
import { Container, Heading, Text, usePrompt } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { ActionMenu } from "../common/action-menu"
import { AdminForm, useDeleteForm } from "../../hooks/api/forms"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

type FormGeneralSectionProps = {
  form: AdminForm
}

export const FormGeneralSection = ({ form }: FormGeneralSectionProps) => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const navigate = useNavigate()

  const { mutateAsync: deleteForm } = useDeleteForm(form.id)

  const handleDelete = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: `Delete form '${form.title}'?`,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
      variant: "danger",
    })

    if (!res) {
      return
    }

    try {
      await deleteForm()
      toast.success("Form deleted")
      navigate(`/settings/forms`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete form")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading level="h2">{form.title}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage form settings and view submissions
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("actions.edit"),
                  to: `edit`,
                },
                {
                  icon: <SquaresPlus />,
                  label: "Builder",
                  to: `builder`,
                },
              ],
            },
            {
              actions: [
                {
                  icon: <Trash />,
                  label: t("actions.delete"),
                  onClick: handleDelete,
                },
              ],
            },
          ]}
        />
      </div>
      <div className="text-ui-fg-subtle grid divide-y">
        <div className="grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            Handle
          </Text>
          <Text size="small" leading="compact">{form.handle || "-"}</Text>
        </div>
        <div className="grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            Domain
          </Text>
          <Text size="small" leading="compact">{form.domain || "-"}</Text>
        </div>
        <div className="grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            Status
          </Text>
          <Text size="small" leading="compact">{form.status || "-"}</Text>
        </div>
      </div>
    </Container>
  )
}
