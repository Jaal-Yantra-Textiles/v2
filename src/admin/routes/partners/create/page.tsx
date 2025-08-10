import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { Container, Heading, Input, Label, Select, Switch, Button } from "@medusajs/ui"
import { useState } from "react"

const CreatePartnerComponent = () => {
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [logo, setLogo] = useState("")
  const [status, setStatus] = useState<"active" | "inactive" | "pending">("pending")
  const [isVerified, setIsVerified] = useState(false)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Backend not implemented for admin partner creation yet
    // This is a placeholder to collect data; hook up to POST /admin/partners when available
    alert("Partner creation via admin API not implemented yet.")
  }

  return (
    <Container className="p-6">
      <Heading>Create Partner</Heading>
      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Manufacturing" />
        </div>
        <div className="col-span-1">
          <Label>Handle</Label>
          <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="acme" />
        </div>
        <div className="col-span-1">
          <Label>Logo URL</Label>
          <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://..." />
        </div>
        <div className="col-span-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="active">Active</Select.Item>
              <Select.Item value="inactive">Inactive</Select.Item>
              <Select.Item value="pending">Pending</Select.Item>
            </Select.Content>
          </Select>
        </div>
        <div className="col-span-1 flex items-end gap-2">
          <Switch checked={isVerified} onCheckedChange={setIsVerified} />
          <Label>Verified</Label>
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" asChild>
            <a href="..">Cancel</a>
          </Button>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </Container>
  )
}

const CreatePartnerModal = () => {
  return (
    <RouteFocusModal>
      <CreatePartnerComponent />
    </RouteFocusModal>
  )
}

export default CreatePartnerModal
