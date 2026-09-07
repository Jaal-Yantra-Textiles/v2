import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"

import { useModalChrome } from "../modal/chrome/use-modal-chrome"
import {
  partnersQueryKeys,
  useAddPartnerAdmin,
} from "../../hooks/api/partners-admin"

/**
 * Create an admin for a partner.
 *
 * Lifted out of the drawer inside `PartnerAdminsSection` so the partner graph
 * can open the same form the section does — chrome and "done" come from
 * whichever shell wraps it (#1856).
 *
 * 🔴 This is the form behind the partner spine's loudest absence. A partner
 * with no admin has *nobody who can sign in*, so a dispatch to them is
 * recorded as successful and then stops dead. Until this was registered, the
 * absent `admins` node's only affordance was an action card pointing at
 * `/partners/:id` — the page the graph is already on, which from inside the
 * workspace tears the graph down to arrive where you already were.
 */
export const AddPartnerAdminForm = ({ partnerId }: { partnerId: string }) => {
  const Chrome = useModalChrome()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<"admin" | "manager" | "owner">("admin")
  const [password, setPassword] = useState("")

  const { mutateAsync: addAdmin, isPending } = useAddPartnerAdmin(partnerId)

  const handleAdd = async () => {
    if (!email.trim()) {
      toast.error("Email is required")
      return
    }
    try {
      const result = await addAdmin({
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        role,
        password: password || undefined,
      })
      toast.success("Admin added", {
        description: `Welcome email sent to ${email}.${
          result.temp_password ? ` Temp password: ${result.temp_password}` : ""
        }`,
      })
      await queryClient.invalidateQueries({
        queryKey: partnersQueryKeys.details(),
      })
      Chrome.onDone()
    } catch (e: any) {
      toast.error("Failed to add admin", {
        description: e?.message || "Could not create admin",
      })
    }
  }

  return (
    <>
      <Chrome.Header>
        <div>
          <Chrome.Title asChild>
            <Heading>Add admin</Heading>
          </Chrome.Title>
          <Text size="small" className="text-ui-fg-subtle">
            They receive a welcome email with login credentials.
          </Text>
        </div>
      </Chrome.Header>

      <Chrome.Body className="flex flex-col gap-y-4 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-y-1">
          <Text size="small" className="text-ui-fg-subtle">
            Email *
          </Text>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@partner.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-1">
            <Text size="small" className="text-ui-fg-subtle">
              First name
            </Text>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="John"
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="small" className="text-ui-fg-subtle">
              Last name
            </Text>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
            />
          </div>
        </div>
        <div className="flex flex-col gap-y-1">
          <Text size="small" className="text-ui-fg-subtle">
            Phone
          </Text>
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
        </div>
        <div className="flex flex-col gap-y-1">
          <Text size="small" className="text-ui-fg-subtle">
            Role
          </Text>
          <Select value={role} onValueChange={(v) => setRole(v as any)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="admin">Admin</Select.Item>
              <Select.Item value="manager">Manager</Select.Item>
              <Select.Item value="owner">Owner</Select.Item>
            </Select.Content>
          </Select>
        </div>
        <div className="flex flex-col gap-y-1">
          <Text size="small" className="text-ui-fg-subtle">
            Password (leave blank to auto-generate)
          </Text>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Auto-generated if empty"
            autoComplete="new-password"
          />
        </div>
      </Chrome.Body>

      <Chrome.Footer>
        <div className="flex w-full items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button variant="secondary" size="small" disabled={isPending}>
              Cancel
            </Button>
          </Chrome.Close>
          <Button size="small" isLoading={isPending} onClick={handleAdd}>
            Add admin
          </Button>
        </div>
      </Chrome.Footer>
    </>
  )
}
