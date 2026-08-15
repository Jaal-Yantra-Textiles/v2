import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Drawer,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Key } from "@medusajs/icons"
import { useState } from "react"

import {
  MCP_SCOPE_LEVELS,
  useDeleteMcpScope,
  useMcpScopes,
  useSecretApiKeys,
  useSetMcpScope,
  type AdminMcpScope,
  type McpScopeLevel,
} from "../../../hooks/api/mcp-scopes"

/**
 * Settings → MCP Access Scopes (#1306 Track C).
 *
 * Narrows ONE machine credential below the process-wide ceiling set by
 * ADMIN_MCP_ENABLE_WRITE / ADMIN_MCP_ENABLE_DANGEROUS. A row can only ever
 * restrict: the effective level is `min(ceiling, row)`, and no row means the
 * ceiling — so removing a row WIDENS a credential rather than revoking it.
 *
 * The page leans on one non-obvious fact throughout: `write` currently exposes
 * exactly what `read` does, because every admin write tool is flagged
 * sensitive. The tool count sits next to every level so that is visible at the
 * moment of choosing, rather than after a client starts refusing calls.
 */

const LEVEL_HINTS: Record<McpScopeLevel, string> = {
  read: "Reads only. Every write is refused over MCP and over /admin/* HTTP.",
  write:
    "No different from read today — every admin write tool is flagged sensitive.",
  sensitive: "Reads plus writes. This is the lowest level that can change data.",
  dangerous: "Everything, including platform-destructive tools.",
}

const levelColor = (level: McpScopeLevel) =>
  level === "read"
    ? "grey"
    : level === "write"
      ? "blue"
      : level === "sensitive"
        ? "orange"
        : "red"

type FormState = {
  principal_type: string
  principal_id: string
  level: McpScopeLevel
  label: string
  note: string
}

const EMPTY_FORM: FormState = {
  principal_type: "api-key",
  principal_id: "",
  level: "read",
  label: "",
  note: "",
}

/** Shared field set — used by both the create modal and the edit drawer. */
const ScopeFields = ({
  form,
  setForm,
  toolsByLevel,
  ceiling,
  lockPrincipal,
}: {
  form: FormState
  setForm: (next: FormState) => void
  toolsByLevel: Record<string, number>
  ceiling?: McpScopeLevel
  lockPrincipal: boolean
}) => {
  // Only fetched for the picker, and only while the form is open.
  const { apiKeys, isLoading: keysLoading } = useSecretApiKeys(
    !lockPrincipal && form.principal_type === "api-key"
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Credential type
        </Label>
        <Select
          value={form.principal_type}
          onValueChange={(v) =>
            setForm({ ...form, principal_type: v, principal_id: "" })
          }
          disabled={lockPrincipal}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="api-key">Secret API key</Select.Item>
            <Select.Item value="oauth">OAuth client</Select.Item>
            <Select.Item value="user">Admin user</Select.Item>
          </Select.Content>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Credential
        </Label>
        {lockPrincipal ? (
          <Text size="small" className="font-mono text-ui-fg-subtle">
            {form.principal_id}
          </Text>
        ) : form.principal_type === "api-key" ? (
          <>
            {keysLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <Select
                value={form.principal_id}
                onValueChange={(v) => setForm({ ...form, principal_id: v })}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select a secret API key" />
                </Select.Trigger>
                <Select.Content>
                  {apiKeys.map((k) => (
                    <Select.Item key={k.id} value={k.id}>
                      {k.title} — {k.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
            <Text size="small" className="text-ui-fg-subtle">
              Scopes key on the key ID (apk_…), never the token. Revoked keys are
              hidden.
            </Text>
          </>
        ) : (
          <Input
            value={form.principal_id}
            placeholder={
              form.principal_type === "user" ? "usr_…" : "OAuth client ID"
            }
            onChange={(e) => setForm({ ...form, principal_id: e.target.value })}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Level
        </Label>
        <Select
          value={form.level}
          onValueChange={(v) => setForm({ ...form, level: v as McpScopeLevel })}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {MCP_SCOPE_LEVELS.map((l) => (
              <Select.Item key={l} value={l}>
                {l} — {toolsByLevel[l] ?? "?"} tools
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Text size="small" className="text-ui-fg-subtle">
          {LEVEL_HINTS[form.level]}
        </Text>
        {ceiling && MCP_SCOPE_LEVELS.indexOf(form.level) >
          MCP_SCOPE_LEVELS.indexOf(ceiling) && (
          <Text size="small" className="text-ui-fg-error">
            Above the current ceiling ({ceiling}). It will be stored but clamped
            to {ceiling} until the env flags are raised.
          </Text>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Label
        </Label>
        <Input
          value={form.label}
          placeholder="What this credential is for"
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Note
        </Label>
        <Textarea
          rows={3}
          value={form.note}
          placeholder="Why it is scoped this way"
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>
    </div>
  )
}

const McpScopesPage = () => {
  const prompt = usePrompt()
  const { scopes, ceiling, levels, isLoading } = useMcpScopes()
  const setScope = useSetMcpScope()
  const deleteScope = useDeleteMcpScope()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMcpScope | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const toolsByLevel: Record<string, number> = {}
  for (const l of levels || []) toolsByLevel[l.level] = l.tools

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setCreateOpen(true)
  }

  const openEdit = (scope: AdminMcpScope) => {
    setForm({
      principal_type: scope.principal_type,
      principal_id: scope.principal_id,
      level: scope.level,
      label: scope.label || "",
      note: scope.note || "",
    })
    setEditing(scope)
  }

  const save = async () => {
    if (!form.principal_id) {
      toast.error("Pick a credential first")
      return
    }

    try {
      const res = await setScope.mutateAsync({
        principal_type: form.principal_type,
        principal_id: form.principal_id,
        level: form.level,
        label: form.label || null,
        note: form.note || null,
      })

      // The backend clamps a row above the ceiling and says so; surfacing it as
      // a success toast would hide that the credential is not at the level just
      // chosen.
      if (res.warning) {
        toast.warning(res.warning)
      } else {
        toast.success(
          `Scoped to ${res.effective_level} — ${res.tools_visible} tools visible`
        )
      }

      setCreateOpen(false)
      setEditing(null)
    } catch (e: any) {
      toast.error(e?.message || "Failed to save scope")
    }
  }

  const remove = async (scope: AdminMcpScope) => {
    const ok = await prompt({
      title: "Remove this scope?",
      description:
        `This does NOT revoke the credential — it WIDENS it back to the ` +
        `process ceiling (${ceiling}). To take access away, revoke the API key ` +
        `or set this row to 'read'. Continue?`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!ok) return

    try {
      await deleteScope.mutateAsync(scope.id)
      toast.success("Scope removed — credential is back at the ceiling")
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove scope")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between px-6 py-4">
        <div>
          <Heading>MCP Access Scopes</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Restrict what a single machine credential can reach over MCP and the
            Admin API. A scope can only narrow — never widen — what the
            environment already allows.
          </Text>
        </div>
        <Button size="small" onClick={openCreate}>
          Scope a credential
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <div className="flex items-center gap-2">
          <Text size="small" weight="plus">
            Ceiling
          </Text>
          {isLoading || !ceiling ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <Badge size="2xsmall" color={levelColor(ceiling)}>
              {ceiling}
            </Badge>
          )}
        </div>
        {(levels || []).map((l) => (
          <div key={l.level} className="flex items-center gap-2">
            <Text size="small" className="text-ui-fg-subtle">
              {l.level}
            </Text>
            <Text size="small" weight="plus">
              {l.tools} tools
            </Text>
          </div>
        ))}
      </div>

      {toolsByLevel.write === toolsByLevel.read && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            <span className="text-ui-fg-base">Note:</span> `write` exposes
            exactly what `read` does, because every admin write tool is flagged
            sensitive. A credential that must change anything needs{" "}
            <span className="text-ui-fg-base">sensitive</span>.
          </Text>
        </div>
      )}

      <div className="px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !scopes?.length ? (
          <Text size="small" className="text-ui-fg-subtle">
            No scoped credentials. Every credential runs at the ceiling (
            {ceiling}).
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {scopes.map((s) => (
              <div
                key={s.id}
                data-testid={`mcp-scope-row-${s.principal_id}`}
                className="flex items-center justify-between rounded-lg border border-ui-border-base px-4 py-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Text size="small" weight="plus">
                      {s.label || s.principal_id}
                    </Text>
                    <Badge size="2xsmall" color={levelColor(s.level)}>
                      {s.level}
                    </Badge>
                    <Text size="small" className="text-ui-fg-subtle">
                      {toolsByLevel[s.level] ?? "?"} tools
                    </Text>
                  </div>
                  <Text
                    size="small"
                    className="font-mono text-ui-fg-subtle"
                    leading="compact"
                  >
                    {s.principal_type} · {s.principal_id}
                  </Text>
                  {s.note && (
                    <Text
                      size="small"
                      className="text-ui-fg-subtle"
                      leading="compact"
                    >
                      {s.note}
                    </Text>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => openEdit(s)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    disabled={deleteScope.isPending}
                    onClick={() => remove(s)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create → FocusModal */}
      <FocusModal open={createOpen} onOpenChange={setCreateOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <Heading>Scope a credential</Heading>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col overflow-y-auto p-6">
            <ScopeFields
              form={form}
              setForm={setForm}
              toolsByLevel={toolsByLevel}
              ceiling={ceiling}
              lockPrincipal={false}
            />
          </FocusModal.Body>
          <FocusModal.Footer>
            <Button
              size="small"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="small"
              onClick={save}
              disabled={setScope.isPending}
              isLoading={setScope.isPending}
            >
              Save
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>

      {/* Edit → Drawer */}
      <Drawer open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <Drawer.Content>
          <Drawer.Header>
            <Heading>Edit scope</Heading>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col overflow-y-auto p-4">
            <ScopeFields
              form={form}
              setForm={setForm}
              toolsByLevel={toolsByLevel}
              ceiling={ceiling}
              lockPrincipal
            />
          </Drawer.Body>
          <Drawer.Footer>
            <Button
              size="small"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              size="small"
              onClick={save}
              disabled={setScope.isPending}
              isLoading={setScope.isPending}
            >
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export default McpScopesPage

export const config = defineRouteConfig({
  label: "MCP Access Scopes",
  icon: Key,
})

export const handle = {
  breadcrumb: () => "MCP Access Scopes",
}
