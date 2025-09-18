"use client"

import { useState } from "react"
import { Button, FocusModal, Heading, Input, Text } from "@medusajs/ui"

export default function CompleteDesignModal({
  completeAction,
}: {
  completeAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button className="w-full sm:w-auto" variant="primary" onClick={() => setOpen(true)}>Complete</Button>
      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content className="z-50 max-w-md w-[92vw] sm:w-full mx-auto my-6 sm:my-8">
          <FocusModal.Header>
            <Heading>Complete Design</Heading>
          </FocusModal.Header>
          <FocusModal.Body className="max-h-[80vh] overflow-y-auto">
            <div className="flex flex-col gap-4 p-2 sm:p-4">
              <Text size="small" className="text-ui-fg-subtle">
                Please enter the total inventory used for this design before completing.
              </Text>
              <form action={async (formData) => {
                await completeAction(formData)
              }} className="flex flex-col gap-4">
                <div>
                  <label className="block mb-1 text-sm">Inventory used</label>
                  <Input name="inventory_used" inputMode="decimal" placeholder="e.g. 3.1" required />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button variant="primary" type="submit">Confirm & Complete</Button>
                </div>
              </form>
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}
