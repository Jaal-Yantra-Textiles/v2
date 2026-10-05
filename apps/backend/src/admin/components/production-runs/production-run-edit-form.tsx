import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Checkbox, Input, Label, Select, Switch, Text, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import {
  AdminProductionRun,
  useProductionRuns,
  useUpdateProductionRun,
} from "../../hooks/api/production-runs"
import { useTaskTemplates } from "../../hooks/api/task-templates"

const schema = z.object({
  quantity: z.number().int().min(1).optional(),
  /**
   * #1676 — this run has NO agreed quantity: open-ended, ongoing work.
   *
   * A separate switch rather than "leave the box empty", because an empty box
   * is a person who has not typed yet. Declaring open-endedness removes the
   * ceiling on what may be billed against this run, so it has to be an act,
   * not an omission.
   */
  open_ended: z.boolean().optional(),
  role: z.string().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  /**
   * #2306 — other runs this one waits on. For partners working the SAME pieces
   * in turn (embroider, then stitch), which approval's `order` cannot express.
   */
  depends_on_run_ids: z.array(z.string()).optional(),
  /**
   * The steps the run is sent with when its waits are met. Without them the
   * release can only tell an admin to dispatch by hand.
   */
  dispatch_template_ids: z.array(z.string()).optional(),
})

type FormValues = z.infer<typeof schema>

interface EditProductionRunFormProps {
  run: AdminProductionRun
}

export const EditProductionRunForm = ({ run }: EditProductionRunFormProps) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateProductionRun(run.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: run.quantity ?? undefined,
      open_ended: run.quantity === null,
      role: run.role ?? "",
      run_type: (run.run_type as "production" | "sample") ?? "production",
      depends_on_run_ids: (run.depends_on_run_ids as string[] | null) ?? [],
      dispatch_template_ids: (run.dispatch_template_ids as string[] | null) ?? [],
    },
  })

  /*
   * Candidates: the other partner runs of the same design. Parents are left
   * out (they never complete on their own work) and so are cancelled runs (they
   * never complete at all — the API refuses them too).
   */
  const { production_runs: designRuns = [] } = useProductionRuns(
    { design_id: run.design_id, limit: 100 },
    { enabled: !!run.design_id }
  )
  const currentDeps = ((run.depends_on_run_ids as string[] | null) ?? []).slice().sort()
  const candidates = (designRuns as AdminProductionRun[]).filter(
    (r) =>
      r.id !== run.id &&
      !!r.partner_id &&
      (r.status !== "cancelled" || currentDeps.includes(r.id))
  )
  const waitLocked =
    !!run.accepted_at || !!run.started_at || run.status === "completed"

  // Templates are only choosable before dispatch: afterwards the tasks exist.
  const canChooseTemplates =
    run.status === "approved" && run.dispatch_state !== "completed" && !waitLocked
  const { task_templates: templates = [] } = useTaskTemplates(
    { limit: 200 },
    { enabled: canChooseTemplates }
  )
  const currentTemplates = ((run.dispatch_template_ids as string[] | null) ?? [])
    .slice()
    .sort()

  const onSubmit = form.handleSubmit(async (data) => {
    const payload: Record<string, any> = {}
    /**
     * `null` is sent DELIBERATELY, and only when the switch is on — the API
     * reads it as "no agreed quantity" rather than as a missing field. An
     * untouched form still sends nothing.
     */
    const nextQuantity = data.open_ended ? null : data.quantity
    const currentQuantity = run.quantity ?? null
    if (nextQuantity !== undefined && nextQuantity !== currentQuantity) {
      payload.quantity = nextQuantity
    }
    if ((data.role ?? "") !== (run.role ?? "")) {
      payload.role = data.role || undefined
    }
    if (data.run_type && data.run_type !== run.run_type) {
      payload.run_type = data.run_type
    }
    const nextDeps = (data.depends_on_run_ids ?? []).slice().sort()
    if (!waitLocked && nextDeps.join(",") !== currentDeps.join(",")) {
      payload.depends_on_run_ids = nextDeps
    }
    const nextTemplates = (data.dispatch_template_ids ?? []).slice().sort()
    if (canChooseTemplates && nextTemplates.join(",") !== currentTemplates.join(",")) {
      payload.dispatch_template_ids = nextTemplates
    }
    if (Object.keys(payload).length === 0) {
      handleSuccess()
      return
    }
    try {
      const res: any = await mutateAsync(payload)
      // Attaching a wait whose upstream is ALREADY complete dispatches the run
      // on the spot and messages its partner — say so, never a quiet "updated".
      if (res?.dependency_release?.result === "dispatched") {
        toast.success("Saved — the run it waits on is already complete, so it was sent to the partner now")
      } else {
        toast.success("Production run updated")
      }
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to update")
    }
  })

  const isOverride = !!run.accepted_at || !!run.started_at
  const openEnded = !!form.watch("open_ended")

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          {isOverride && (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
              <span className="text-ui-fg-subtle text-xs">
                Run has been accepted/started. Changes apply as an admin override.
              </span>
            </div>
          )}
          <Form.Field
            control={form.control}
            name="run_type"
            render={({ field: { value, onChange, ...rest } }) => (
              <Form.Item>
                <Form.Label>Type</Form.Label>
                <Form.Control>
                  <Select value={value} onValueChange={onChange} {...rest}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="production">Production</Select.Item>
                      <Select.Item value="sample">Sample</Select.Item>
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Quantity</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    min={1}
                    {...field}
                    disabled={openEnded}
                    value={openEnded ? "" : (field.value ?? "")}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="open_ended"
            render={({ field: { value, onChange } }) => (
              <Form.Item>
                <div className="flex items-center gap-x-2">
                  <Switch
                    id="production-run-open-ended"
                    checked={!!value}
                    onCheckedChange={(checked) => onChange(!!checked)}
                  />
                  <Label size="xsmall" htmlFor="production-run-open-ended">
                    No agreed quantity (open-ended)
                  </Label>
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Ongoing work with no fixed order. Payments against this run
                  are not capped at an agreed quantity — nothing will refuse a
                  claim for more than was ordered, because nothing was ordered.
                </Text>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="role"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Role</Form.Label>
                <Form.Control>
                  <Input
                    placeholder="e.g. manufacturing, cutting"
                    {...field}
                    value={field.value ?? ""}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="depends_on_run_ids"
            render={({ field: { value, onChange } }) => {
              const selected = value ?? []
              const toggle = (id: string, on: boolean) =>
                onChange(on ? [...selected, id] : selected.filter((v) => v !== id))
              return (
                <Form.Item>
                  <Form.Label>Waits for</Form.Label>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Starts by itself once every run ticked here is completed —
                    e.g. stitching waits for embroidery on the same pieces.
                    {waitLocked
                      ? " Locked: this run has been accepted, started or completed."
                      : ""}
                  </Text>
                  {candidates.length === 0 ? (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      No other partner runs on this design.
                    </Text>
                  ) : (
                    <div className="flex flex-col gap-y-2">
                      {candidates.map((r) => {
                        const inputId = `waits-for-${r.id}`
                        const who =
                          r.snapshot?.provenance?.partner_name || r.partner_id
                        return (
                          <div key={r.id} className="flex items-start gap-x-2">
                            <Checkbox
                              id={inputId}
                              checked={selected.includes(r.id)}
                              disabled={waitLocked}
                              onCheckedChange={(c) => toggle(r.id, c === true)}
                            />
                            <Label size="xsmall" htmlFor={inputId}>
                              {r.role || "run"} · {r.status}
                              <span className="text-ui-fg-subtle block">
                                {who} — {r.id}
                              </span>
                            </Label>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
          {canChooseTemplates && (
            <Form.Field
              control={form.control}
              name="dispatch_template_ids"
              render={({ field: { value, onChange } }) => {
                const selected = value ?? []
                const toggle = (id: string, on: boolean) =>
                  onChange(on ? [...selected, id] : selected.filter((v) => v !== id))
                return (
                  <Form.Item>
                    <Form.Label>Send with these steps</Form.Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      The tasks the partner gets when this run starts. Without
                      them, a run whose waits are met only tells an admin to
                      send it by hand.
                    </Text>
                    <div className="flex flex-col gap-y-2">
                      {templates
                        .filter((t) => !!t.id)
                        .map((t) => {
                          const tid = t.id as string
                          const inputId = `send-with-${tid}`
                          const category =
                            typeof t.category === "object" ? t.category?.name : t.category
                          return (
                            <div key={tid} className="flex items-start gap-x-2">
                              <Checkbox
                                id={inputId}
                                checked={selected.includes(tid)}
                                onCheckedChange={(c) => toggle(tid, c === true)}
                              />
                              <Label size="xsmall" htmlFor={inputId}>
                                {t.name}
                                {category ? (
                                  <span className="text-ui-fg-subtle"> · {category}</span>
                                ) : null}
                              </Label>
                            </div>
                          )
                        })}
                    </div>
                    <Form.ErrorMessage />
                  </Form.Item>
                )
              }}
            />
          )}
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
