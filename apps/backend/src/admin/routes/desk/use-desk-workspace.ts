import { toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import debounce from "lodash/debounce"
import { useEffect, useMemo, useRef } from "react"
import { sdk } from "../../lib/config"

/**
 * Server-side persistence for the Desk workspace. Reads from / writes to
 * /admin/desk/workspace, which is backed by user.metadata.desk_workspace.
 *
 * Hydration strategy: the page renders immediately from a localStorage
 * cache (synchronous) and this hook then issues a GET; when the server
 * value arrives, the caller decides whether to reconcile (we expose the
 * raw query so the page can compare its current model against the
 * server snapshot).
 *
 * Saves are debounced 750ms — FlexLayout fires onModelChange on every
 * selection click, drag preview update, etc., and we don't want to PUT
 * the server that often.
 */

export type DeskWorkspaceBlob = {
  layout: unknown
  tab_paths: Record<string, string>
}

const QUERY_KEY = ["desk-workspace"] as const

export const useDeskWorkspace = () => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      sdk.client.fetch<{ workspace: DeskWorkspaceBlob | null }>(
        "/admin/desk/workspace",
        { method: "GET" }
      ),
    // Hydrate happens once per session; refetching on every focus would
    // overwrite in-flight local edits.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  // Throttle save-failed toasts: if the server hiccups we still try every
  // 750ms via the debounced save, but the user only needs to know once
  // until things start working again.
  const lastErrorToastRef = useRef<number>(0)
  const mutation = useMutation({
    mutationFn: (blob: DeskWorkspaceBlob) =>
      sdk.client.fetch<{ workspace: DeskWorkspaceBlob }>(
        "/admin/desk/workspace",
        { method: "PUT", body: blob }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, { workspace: data.workspace })
      lastErrorToastRef.current = 0
    },
    onError: () => {
      const now = Date.now()
      if (now - lastErrorToastRef.current < 30_000) return
      lastErrorToastRef.current = now
      toast.warning("Desk workspace not saved", {
        description:
          "Your layout is still cached locally, but couldn't be saved to your account. Retrying…",
      })
    },
  })

  const latestBlobRef = useRef<DeskWorkspaceBlob | null>(null)
  const debouncedSaveRef = useRef(
    debounce((blob: DeskWorkspaceBlob) => {
      mutation.mutate(blob)
    }, 750)
  )

  // Flush any pending save on unmount so a quick tab close doesn't lose state.
  useEffect(() => {
    const debounced = debouncedSaveRef.current
    return () => {
      debounced.flush()
    }
  }, [])

  const save = useMemo(
    () => (blob: DeskWorkspaceBlob) => {
      latestBlobRef.current = blob
      debouncedSaveRef.current(blob)
    },
    []
  )

  // Cancel any in-flight debounced save, drop the server blob, and clear
  // our query cache. The caller is responsible for clearing localStorage
  // and resetting its FlexLayout model in the same tick.
  const reset = useMemo(
    () => async (): Promise<void> => {
      debouncedSaveRef.current.cancel()
      try {
        await sdk.client.fetch("/admin/desk/workspace", { method: "DELETE" })
      } catch {
        // best-effort — localStorage clear in the caller is what the user
        // actually sees; server cleanup will re-sync on next change.
      }
      queryClient.setQueryData(QUERY_KEY, { workspace: null })
      lastErrorToastRef.current = 0
    },
    [queryClient]
  )

  return {
    workspace: query.data?.workspace ?? null,
    isReady: !query.isPending,
    error: query.error,
    save,
    reset,
  }
}
