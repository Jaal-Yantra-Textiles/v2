import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { Controller, useForm } from "react-hook-form"
import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { useCreateReferral } from "../../../hooks/api/companies"

type FormValues = {
  name: string
  email: string
  access_level: "investor" | "view_only"
  note: string
}

const InviteForm = () => {
  const { handleSuccess } = useRouteModal()
  const form = useForm<FormValues>({
    defaultValues: {
      name: "",
      email: "",
      access_level: "investor",
      note: "",
    },
  })

  const { mutateAsync, isPending } = useCreateReferral({
    onSuccess: () => {
      toast.success("Invite sent — our team will follow up")
      handleSuccess()
    },
    onError: (e: any) => toast.error(e?.message || "Failed to send invite"),
  })

  const onSubmit = form.handleSubmit(async (v) => {
    if (!v.name.trim() || !v.email.trim()) {
      toast.error("Name and email are required")
      return
    }
    return mutateAsync({
      name: v.name.trim(),
      email: v.email.trim(),
      access_level: v.access_level,
      note: v.note.trim() || null,
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Invite someone</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <Text size="small" className="text-ui-fg-subtle">
          Invite a friend or fellow investor. Onboarding is invite-only, so our
          team reviews and reaches out — we'll let them know you referred them.
        </Text>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Name
          </Label>
          <Input
            placeholder="Jane Doe"
            {...form.register("name", { required: true })}
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Email
          </Label>
          <Input
            type="email"
            placeholder="jane@example.com"
            {...form.register("email", { required: true })}
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Invite as
          </Label>
          <Controller
            control={form.control}
            name="access_level"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="investor">
                    Investor — can participate in deals
                  </Select.Item>
                  <Select.Item value="view_only">
                    View-only — can browse, not participate
                  </Select.Item>
                </Select.Content>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Message <span className="text-ui-fg-muted">(optional)</span>
          </Label>
          <Textarea
            placeholder="A short note we'll include in the invite…"
            {...form.register("note")}
          />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending}>
            Send invite
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

export const Invite = () => {
  return (
    <RouteDrawer>
      <InviteForm />
    </RouteDrawer>
  )
}
