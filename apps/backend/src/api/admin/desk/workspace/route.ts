import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IUserModuleService } from "@medusajs/types"

/**
 * GET/PUT /admin/desk/workspace
 *
 * Per-admin-user persistence for the Desk workspace UI state. We stash the
 * FlexLayout JSON + per-tab pathnames on user.metadata.desk_workspace so
 * the layout follows the user across browsers/devices without needing a
 * new module + migration. The client uses localStorage as an instant
 * cache and reconciles to this endpoint's value on hydrate.
 *
 * Shape of the persisted blob:
 *   {
 *     layout:     IJsonModel        // FlexLayout's serialised tree
 *     tab_paths:  Record<id, path>  // per-tab pathname inside its
 *                                   // MemoryRouter (e.g. /designs/abc/edit)
 *   }
 */

const WORKSPACE_KEY = "desk_workspace" as const

type DeskWorkspaceBlob = {
  layout: unknown
  tab_paths: Record<string, string>
}

const getUserId = (req: AuthenticatedMedusaRequest): string => {
  const userId = req.auth_context?.actor_id
  if (!userId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No authenticated admin user"
    )
  }
  return userId
}

const readWorkspace = (
  metadata: Record<string, unknown> | null | undefined
): DeskWorkspaceBlob | null => {
  const raw = (metadata || {})[WORKSPACE_KEY]
  if (!raw || typeof raw !== "object") return null
  const blob = raw as Partial<DeskWorkspaceBlob>
  return {
    layout: blob.layout ?? null,
    tab_paths:
      blob.tab_paths && typeof blob.tab_paths === "object"
        ? (blob.tab_paths as Record<string, string>)
        : {},
  }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const userId = getUserId(req)
  const userService = req.scope.resolve(Modules.USER) as IUserModuleService

  const user = await userService.retrieveUser(userId)
  const workspace = readWorkspace(user.metadata as Record<string, unknown>)

  res.json({ workspace })
}

export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const userId = getUserId(req)
  const userService = req.scope.resolve(Modules.USER) as IUserModuleService

  const body = (req.body || {}) as Partial<DeskWorkspaceBlob>
  if (!body || typeof body !== "object") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Body must be { layout, tab_paths }"
    )
  }

  // Merge into existing metadata so we don't clobber other keys.
  const user = await userService.retrieveUser(userId)
  const currentMeta = (user.metadata as Record<string, unknown>) || {}

  const nextWorkspace: DeskWorkspaceBlob = {
    layout: body.layout ?? null,
    tab_paths:
      body.tab_paths && typeof body.tab_paths === "object"
        ? body.tab_paths
        : {},
  }

  await userService.updateUsers({
    id: userId,
    metadata: {
      ...currentMeta,
      [WORKSPACE_KEY]: nextWorkspace,
    },
  })

  res.json({ workspace: nextWorkspace })
}
