import { useState } from "react"
import { Button, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"

import { useModalChrome } from "../modal/chrome/use-modal-chrome"
import { useEntityGraph } from "../../hooks/api/graph"
import { useCreateWorkNote } from "../../hooks/api/work-notes"

const NO_BOX = "__none__"

/**
 * Add a note to the Pending work board (#2625 S2).
 *
 * The note gets a reference (N-12) on save, shown in the toast, so it can be
 * quoted straight away. Pinning it to a box puts "· 1 note" on that box.
 */
export const AddWorkNoteForm = () => {
  const Chrome = useModalChrome()
  const { graph } = useEntityGraph("queue", "pending-work")
  const boxes = (graph?.nodes ?? []).filter((n) => n.key !== "notes")

  const [body, setBody] = useState("")
  const [followUp, setFollowUp] = useState(false)
  const [due, setDue] = useState("")
  const [box, setBox] = useState(NO_BOX)
  const [href, setHref] = useState("")

  const { mutateAsync, isPending } = useCreateWorkNote()

  const save = async () => {
    if (!body.trim()) {
      toast.error("Write the note first")
      return
    }
    try {
      const { work_note } = await mutateAsync({
        body: body.trim(),
        kind: followUp || due ? "follow_up" : "note",
        due_at: due || null,
        node_key: box === NO_BOX ? null : box,
        href: href.trim() || null,
      })
      toast.success(`Saved as ${work_note.reference}`)
      Chrome.onDone()
    } catch (e: any) {
      toast.error(e?.message ?? "The note could not be saved")
    }
  }

  return (
    <>
      <Chrome.Header>
        <Chrome.Title asChild>
          <Heading level="h2">Add a note</Heading>
        </Chrome.Title>
      </Chrome.Header>

      <Chrome.Body className="flex flex-col gap-y-4 overflow-y-auto p-6">
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="work-note-body">Note</Label>
          <Textarea
            id="work-note-body"
            className="min-h-[100px]"
            placeholder="Ask Sreeni for measurements"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="work-note-due">Due (optional)</Label>
            <Input id="work-note-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label>Box (optional)</Label>
            <Select value={box} onValueChange={setBox}>
              <Select.Trigger>
                <Select.Value placeholder="Not on a box" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value={NO_BOX}>Not on a box</Select.Item>
                {boxes.map((b) => (
                  <Select.Item key={b.key} value={b.key}>
                    {b.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="work-note-href">Link to a record (optional)</Label>
          <Input
            id="work-note-href"
            placeholder="/orders/order_01…"
            value={href}
            onChange={(e) => setHref(e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            An admin path. The note's row in the drawer opens it.
          </Text>
        </div>

        <label className="flex items-center gap-x-2">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
          <Text size="small">This is a follow-up (a due date makes it one too)</Text>
        </label>
      </Chrome.Body>

      <Chrome.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </Chrome.Close>
          <Button size="small" onClick={save} isLoading={isPending}>
            Save note
          </Button>
        </div>
      </Chrome.Footer>
    </>
  )
}
