import { useMutation, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

/** #2625 S2 — notes on the Pending work board. Mirrors `/admin/work-notes`. */
export type AdminWorkNote = {
  id: string
  ref: number
  reference: string
  body: string
  kind: "note" | "follow_up"
  status: "open" | "done"
  due_at: string | null
  due: string | null
  overdue: boolean
  node_key: string | null
  href: string | null
}

export type CreateWorkNoteInput = {
  body: string
  kind?: "note" | "follow_up"
  due_at?: string | null
  node_key?: string | null
  href?: string | null
}

export const useCreateWorkNote = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateWorkNoteInput) =>
      sdk.client.fetch<{ work_note: AdminWorkNote }>("/admin/work-notes", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      // The board counts notes and shows them on their box.
      queryClient.invalidateQueries({ queryKey: ["graph"] })
    },
  })
}
