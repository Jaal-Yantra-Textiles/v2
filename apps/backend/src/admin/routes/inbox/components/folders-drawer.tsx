import { useEffect, useState } from "react"
import { Badge, Button, Checkbox, Drawer, Input, Label, Text, toast } from "@medusajs/ui"

import {
  InboundMailbox,
  useCreateInboundMailbox,
  useInboundMailboxes,
  useSetInboundMailboxes,
} from "../../../hooks/api/inbound-emails"

const SPECIAL_LABEL: Record<string, string> = {
  "\\Inbox": "Inbox",
  "\\Sent": "Sent",
  "\\Drafts": "Drafts",
  "\\Trash": "Trash",
  "\\Junk": "Junk",
  "\\Archive": "Archive",
}

/**
 * #2377 — pick which folders of the email account the Inbox reads, or make a
 * new one. The list comes live from iCloud; saving changes what the 5-minute
 * sync reads. A new folder is created on iCloud itself, so a mail rule can
 * then file mail into it.
 */
export const FoldersDrawer = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { mailboxes, platform, isLoading, error, refetch } = useInboundMailboxes({ enabled: open })
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState("")

  // Start from what the account is reading now, each time the drawer opens.
  useEffect(() => {
    if (open && mailboxes) setChosen(new Set(mailboxes.filter((m) => m.reading).map((m) => m.path)))
  }, [open, mailboxes])

  const save = useSetInboundMailboxes({
    onSuccess: (r) => {
      toast.success(`Reading ${r.mailboxes.length} folder(s). New mail arrives within 5 minutes.`)
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })
  const create = useCreateInboundMailbox({
    onSuccess: (r) => {
      toast.success(`Created "${r.path}"${r.reading ? " and reading it" : ""}`)
      setNewName("")
      refetch()
    },
    onError: (e) => toast.error(e.message),
  })

  const toggle = (path: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const ours = (mailboxes ?? []).filter((m) => !m.special_use || m.special_use === "\\Inbox")
  const system = (mailboxes ?? []).filter((m) => m.special_use && m.special_use !== "\\Inbox")

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Folders to read</Drawer.Title>
          <Drawer.Description>
            {platform ? `${platform.name}: tick` : "Tick"} the folders whose mail should appear in the Inbox.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
          {isLoading ? (
            <Text size="small" className="text-ui-fg-subtle">Reading the folder list from the mailbox…</Text>
          ) : error ? (
            <Text size="small" className="text-ui-fg-error">{error.message}</Text>
          ) : (
            <>
              <FolderList rows={ours} chosen={chosen} onToggle={toggle} />
              {system.length > 0 && (
                <div className="flex flex-col gap-y-2">
                  <Text size="xsmall" className="text-ui-fg-muted uppercase">System folders</Text>
                  <FolderList rows={system} chosen={chosen} onToggle={toggle} />
                </div>
              )}
            </>
          )}

          <div className="border-ui-border-base flex flex-col gap-y-2 border-t pt-4">
            <Label size="small" htmlFor="new-folder">New folder</Label>
            <div className="flex gap-2">
              <Input
                id="new-folder"
                size="small"
                placeholder="e.g. CRM, Partner, Updates"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                size="small"
                variant="secondary"
                disabled={!newName.trim()}
                isLoading={create.isPending}
                onClick={() => create.mutate({ name: newName.trim() })}
              >
                Create
              </Button>
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Created in the iCloud account and read from now on. Add an iCloud mail rule to file mail into it.
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </Drawer.Close>
          <Button
            size="small"
            disabled={!chosen.size || isLoading || !!error}
            isLoading={save.isPending}
            onClick={() => save.mutate({ mailboxes: [...chosen] })}
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const FolderList = ({
  rows,
  chosen,
  onToggle,
}: {
  rows: InboundMailbox[]
  chosen: Set<string>
  onToggle: (path: string) => void
}) => (
  <div className="flex flex-col gap-y-1">
    {rows.map((m) => (
      <label
        key={m.path}
        className="hover:bg-ui-bg-base-hover flex cursor-pointer items-center gap-3 rounded-md px-2 py-2"
      >
        <Checkbox checked={chosen.has(m.path)} onCheckedChange={() => onToggle(m.path)} />
        <Text size="small" className="truncate">{m.path}</Text>
        <div className="ml-auto flex gap-1">
          {m.special_use && <Badge size="2xsmall">{SPECIAL_LABEL[m.special_use] ?? m.special_use}</Badge>}
          {m.missing && <Badge size="2xsmall" color="red">Not on the account</Badge>}
        </div>
      </label>
    ))}
  </div>
)
