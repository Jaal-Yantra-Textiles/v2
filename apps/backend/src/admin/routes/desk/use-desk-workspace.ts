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

  const mutation = useMutation({
    mutationFn: (blob: DeskWorkspaceBlob) =>
      sdk.client.fetch<{ workspace: DeskWorkspaceBlob }>(
        "/admin/desk/workspace",
        { method: "PUT", body: blob }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, { workspace: data.workspace })
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

  return {
    workspace: query.data?.workspace ?? null,
    isReady: !query.isPending,
    error: query.error,
    save,
  }
}
